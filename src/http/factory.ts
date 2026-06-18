import {
  _resetGlobals,
  _setGlobalOptions,
  _globalRequestMiddleware,
  _globalResponseMiddleware,
} from "./globals";
import { PendingRequest } from "./pending-request";
import { Batch, Pool } from "./pool";
import {
  buildFakeResponse,
  ResponseSequence,
  allowStrayRequests,
  assertNothingSent,
  assertNotSent,
  assertSent,
  assertSentCount,
  fake,
  fakeReset,
  fakeSequence,
  preventStrayRequests,
  recorded,
  type RecordedRequest,
} from "./fake";
import type { HttpClientOptions, RequestMiddlewareFn, ResponseMiddlewareFn } from "./types";
import type { FakeBody, FakeResponder } from "./types";
import type { HttpResponse } from "./http-response";

// ─── HttpClient handle type ───────────────────────────────────────────────

// All fluent + terminal methods are forwarded via the Proxy; we type the
// full surface for consumers without duplicating the implementation.
export interface HttpClientHandle extends Pick<
  PendingRequest,
  | "baseUrl"
  | "withHeaders"
  | "withHeader"
  | "replaceHeaders"
  | "accept"
  | "acceptJson"
  | "contentType"
  | "withToken"
  | "withBasicAuth"
  | "asJson"
  | "asForm"
  | "asMultipart"
  | "attach"
  | "withBody"
  | "withQueryParameters"
  | "withUrlParameters"
  | "withOptions"
  | "timeout"
  | "connectTimeout"
  | "retry"
  | "withRequestMiddleware"
  | "withResponseMiddleware"
  | "get"
  | "head"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "send"
> {
  pool(
    cb: (pool: Pool) => unknown,
    opts?: { concurrency?: number },
  ): Promise<HttpResponse[] & Record<string, HttpResponse>>;
  batch(cb: (pool: Pool) => unknown): Batch;
}

// ─── Macro registry ────────────────────────────────────────────────────────

const _macros = new Map<string, () => unknown>();

// ─── createHttpClient ─────────────────────────────────────────────────────

export function createHttpClient(options: HttpClientOptions = {}): HttpClientHandle {
  const clientPool = (cb: (pool: Pool) => unknown, opts?: { concurrency?: number }) => {
    const pool = new Pool(options);
    cb(pool);
    return pool._run(opts?.concurrency ?? 0);
  };

  const clientBatch = (cb: (pool: Pool) => unknown): Batch => {
    const pool = new Pool(options);
    cb(pool);
    return new Batch(pool._descriptors);
  };

  return new Proxy({ pool: clientPool, batch: clientBatch } as unknown as HttpClientHandle, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      const req = new PendingRequest(options);
      const method = (req as unknown as Record<string, unknown>)[prop];
      if (typeof method === "function") return (method as Function).bind(req);
      return undefined;
    },
  });
}

// ─── Http facade ──────────────────────────────────────────────────────────

type FakeMapValue = Response | string | number | ResponseSequence | FakeResponder;

export interface HttpFacade extends HttpClientHandle {
  // Fake layer
  fake(): void;
  fake(urlMap: Record<string, FakeMapValue>): void;
  fake(responder: (req: Request) => Response | Promise<Response>): void;
  fakeSequence(): ResponseSequence;
  fakeReset(): void;
  response(body?: FakeBody, status?: number, headers?: HeadersInit): Response;
  sequence(): ResponseSequence;
  preventStrayRequests(): void;
  allowStrayRequests(patterns: string[]): void;
  assertSent(predicate: (req: RecordedRequest) => boolean): void;
  assertNotSent(predicate: (req: RecordedRequest) => boolean): void;
  assertSentCount(count: number): void;
  assertNothingSent(): void;
  recorded(filter?: (req: RecordedRequest) => boolean): RecordedRequest[];

  // Global config
  globalOptions(init: RequestInit): void;
  globalRequestMiddleware(fn: RequestMiddlewareFn): void;
  globalResponseMiddleware(fn: ResponseMiddlewareFn): void;
  resetGlobals(): void;

  // Macros
  macro(name: string, factory: () => unknown): void;

  [macro: string]: unknown;
}

const _facadePool = (cb: (pool: Pool) => unknown, opts?: { concurrency?: number }) => {
  const pool = new Pool();
  cb(pool);
  return pool._run(opts?.concurrency ?? 0);
};

const _facadeBatch = (cb: (pool: Pool) => unknown): Batch => {
  const pool = new Pool();
  cb(pool);
  return new Batch(pool._descriptors);
};

const _staticMethods: Record<string, unknown> = {
  fake,
  fakeSequence,
  fakeReset,
  response: buildFakeResponse,
  sequence: () => new ResponseSequence(),
  preventStrayRequests,
  allowStrayRequests,
  assertSent,
  assertNotSent,
  assertSentCount,
  assertNothingSent,
  recorded,
  globalOptions: _setGlobalOptions,
  globalRequestMiddleware: (fn: RequestMiddlewareFn) => _globalRequestMiddleware.push(fn),
  globalResponseMiddleware: (fn: ResponseMiddlewareFn) => _globalResponseMiddleware.push(fn),
  resetGlobals: _resetGlobals,
  macro: (name: string, factory: () => unknown) => _macros.set(name, factory),
  pool: _facadePool,
  batch: _facadeBatch,
};

export const Http: HttpFacade = new Proxy({} as unknown as HttpFacade, {
  get(_target, prop) {
    if (typeof prop !== "string") return undefined;

    // Static facade methods
    if (prop in _staticMethods) return _staticMethods[prop];

    // Registered macros
    const macro = _macros.get(prop);
    if (macro !== undefined) return macro;

    // Fluent/terminal methods via fresh PendingRequest (no seeded options)
    const req = new PendingRequest();
    const method = (req as unknown as Record<string, unknown>)[prop];
    if (typeof method === "function") return (method as Function).bind(req);

    return undefined;
  },
});
