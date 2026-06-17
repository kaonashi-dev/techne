import type { FakeBody, FakeResponder } from "./types";

// ─── ResponseSequence ──────────────────────────────────────────────────────

export class ResponseSequence {
  private _responses: Response[] = [];
  private _emptyFallback: Response | null = null;

  push(body?: FakeBody, status = 200): this {
    this._responses.push(buildFakeResponse(body, status));
    return this;
  }

  pushStatus(status: number): this {
    return this.push(undefined, status);
  }

  whenEmpty(response: Response): this {
    this._emptyFallback = response;
    return this;
  }

  next(): Response {
    if (this._responses.length > 0) {
      return this._responses.shift()!;
    }
    if (this._emptyFallback) {
      return this._emptyFallback.clone();
    }
    throw new Error("ResponseSequence exhausted with no whenEmpty fallback");
  }
}

// ─── RecordedRequest ───────────────────────────────────────────────────────

export class RecordedRequest {
  constructor(
    private readonly _request: Request,
    private readonly _bodyText: string,
    private readonly _response: Response,
  ) {}

  url(): string {
    return this._request.url;
  }
  method(): string {
    return this._request.method;
  }
  header(name: string): string | null {
    return this._request.headers.get(name);
  }
  hasHeader(name: string, value?: string): boolean {
    const h = this._request.headers.get(name);
    if (h === null) return false;
    return value === undefined ? true : h === value;
  }
  body(): string {
    return this._bodyText;
  }
  data(): Record<string, unknown> {
    try {
      return JSON.parse(this._bodyText) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  response(): Response {
    return this._response;
  }
}

// ─── Glob matching ─────────────────────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped.replace(/\*/g, ".*"));
}

function matchesPattern(pattern: string, url: string): boolean {
  return globToRegex(pattern).test(url);
}

// ─── Response builder ──────────────────────────────────────────────────────

export function buildFakeResponse(
  body?: FakeBody | number,
  status = 200,
  headers?: HeadersInit,
): Response {
  if (body === undefined || body === null) {
    return new Response(null, { status, headers });
  }
  if (typeof body === "number") {
    return new Response(null, { status: body, headers });
  }
  if (typeof body === "string") {
    const h = new Headers(headers);
    if (!h.has("content-type")) h.set("content-type", "text/plain");
    return new Response(body, { status, headers: h });
  }
  const h = new Headers(headers);
  if (!h.has("content-type")) h.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: h });
}

// ─── Fake store state ──────────────────────────────────────────────────────

type FakeMapValue = Response | string | number | ResponseSequence | FakeResponder;
type FakeMatcher = "empty200" | Map<string, FakeMapValue> | FakeResponder;

let _fakeActive = false;
let _fakeMatcher: FakeMatcher = "empty200";
let _fakeRecorded: RecordedRequest[] = [];
let _fakePreventStray = false;
let _fakeAllowStrayPatterns: string[] = [];

export function _isFakeActive(): boolean {
  return _fakeActive;
}

export async function _resolveFakeResponse(req: Request): Promise<Response> {
  const url = req.url;

  if (typeof _fakeMatcher === "function") {
    return _fakeMatcher(req);
  }

  if (_fakeMatcher === "empty200") {
    return new Response(null, { status: 200 });
  }

  // URL map — iterate in insertion order, wildcard last
  const map = _fakeMatcher;
  for (const [pattern, value] of map) {
    if (matchesPattern(pattern, url)) {
      return resolveMapValue(value, req);
    }
  }

  // Unmatched
  if (_fakePreventStray) {
    const allowed = _fakeAllowStrayPatterns.some((p) => matchesPattern(p, url));
    if (!allowed) {
      throw new Error(`Stray request to ${url} — call Http.fake() or Http.allowStrayRequests()`);
    }
    // Allowed stray → return a default empty 200 (no real network call in fake mode)
    return new Response(null, { status: 200 });
  }

  // No match, no preventStray → 200 empty
  return new Response(null, { status: 200 });
}

export function _isStrayAllowed(url: string): boolean {
  return _fakeAllowStrayPatterns.some((p) => matchesPattern(p, url));
}

export function _isStrayPrevented(): boolean {
  return _fakePreventStray;
}

function resolveMapValue(value: FakeMapValue, req: Request): Response | Promise<Response> {
  if (value instanceof Response) return value.clone();
  if (value instanceof ResponseSequence) return value.next();
  if (typeof value === "function") return value(req);
  if (typeof value === "number") return new Response(null, { status: value });
  if (typeof value === "string") {
    return new Response(value, { headers: { "content-type": "text/plain" } });
  }
  return new Response(null, { status: 200 });
}

export function _recordFakeEntry(req: Request, bodyText: string, res: Response): void {
  _fakeRecorded.push(new RecordedRequest(req, bodyText, res));
}

// ─── Public API (attached to Http facade in factory.ts) ────────────────────

export function fake(
  arg?: Record<string, FakeMapValue> | ((req: Request) => Response | Promise<Response>),
): void {
  _fakeActive = true;
  _fakeRecorded = [];
  _fakePreventStray = false;
  _fakeAllowStrayPatterns = [];

  if (arg === undefined) {
    _fakeMatcher = "empty200";
  } else if (typeof arg === "function") {
    _fakeMatcher = arg;
  } else {
    _fakeMatcher = new Map(Object.entries(arg));
  }
}

export function fakeSequence(): ResponseSequence {
  const seq = new ResponseSequence();
  _fakeActive = true;
  _fakeRecorded = [];
  _fakePreventStray = false;
  _fakeAllowStrayPatterns = [];
  _fakeMatcher = new Map([["*", seq]]);
  return seq;
}

export function fakeReset(): void {
  _fakeActive = false;
  _fakeRecorded = [];
  _fakePreventStray = false;
  _fakeAllowStrayPatterns = [];
}

export function preventStrayRequests(): void {
  _fakePreventStray = true;
}

export function allowStrayRequests(patterns: string[]): void {
  _fakeAllowStrayPatterns = patterns;
}

export function recorded(filter?: (req: RecordedRequest) => boolean): RecordedRequest[] {
  if (!filter) return [..._fakeRecorded];
  return _fakeRecorded.filter(filter);
}

export function assertSent(predicate: (req: RecordedRequest) => boolean): void {
  const found = _fakeRecorded.some(predicate);
  if (!found) throw new Error("Http.assertSent: no recorded request matched the predicate");
}

export function assertNotSent(predicate: (req: RecordedRequest) => boolean): void {
  const found = _fakeRecorded.some(predicate);
  if (found) throw new Error("Http.assertNotSent: a recorded request matched the predicate");
}

export function assertSentCount(count: number): void {
  if (_fakeRecorded.length !== count) {
    throw new Error(
      `Http.assertSentCount: expected ${count} request(s), but got ${_fakeRecorded.length}`,
    );
  }
}

export function assertNothingSent(): void {
  assertSentCount(0);
}
