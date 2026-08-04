import { ConnectionException, RequestException } from "./exceptions";
import { HttpResponse } from "./http-response";
import {
  buildQueryString,
  expandUrlTemplate,
  isPlainObject,
  joinMiddleware,
  mergeHeaders,
  normalizeBaseUrl,
} from "./internal";
import {
  _isFakeActive,
  _isStrayAllowed,
  _isStrayPrevented,
  _recordFakeEntry,
  _resolveFakeResponse,
} from "./fake";
import { _globalRequestInit, _globalRequestMiddleware, _globalResponseMiddleware } from "./globals";
import type {
  BodyFormat,
  HttpClientOptions,
  RequestMiddlewareFn,
  ResponseMiddlewareFn,
  RetryConfig,
} from "./types";

interface Attachment {
  name: string;
  value: Blob | string;
  filename?: string;
}

export class PendingRequest {
  private _baseUrl = "";
  private _urlParams: Record<string, string> = {};
  private _queryParams: Record<string, unknown> = {};
  private _headers = new Headers();
  private _format: BodyFormat = "json";
  private _bodyData: unknown = undefined;
  private _rawBody: BodyInit | null = null;
  private _rawContentType: string | null = null;
  private _attachments: Attachment[] = [];
  private _extraInit: RequestInit = {};
  private _fetchImpl: typeof globalThis.fetch | null = null;
  private _signal: AbortSignal | null = null;
  private _timeout: number | null = null;
  private _connectTimeout: number | null = null;
  private _retry: RetryConfig | null = null;
  private _requestMiddleware: RequestMiddlewareFn[] = [];
  private _responseMiddleware: ResponseMiddlewareFn[] = [];
  /** Internal seam: inject a fake sleeper in tests to avoid real delays. */
  _sleeper: (ms: number) => Promise<void> = (ms) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(options: HttpClientOptions = {}) {
    if (options.baseUrl) this._baseUrl = normalizeBaseUrl(options.baseUrl);
    if (options.headers) this._headers = new Headers(options.headers);
    if (options.token) this._headers.set("Authorization", `Bearer ${options.token}`);
    if (options.basicAuth) {
      const { username, password } = options.basicAuth;
      this._headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
    }
    if (options.timeout !== undefined) this._timeout = options.timeout;
    if (options.connectTimeout !== undefined) this._connectTimeout = options.connectTimeout;
    if (options.retry !== undefined) this._retry = options.retry;
    if (options.fetch !== undefined) this._fetchImpl = options.fetch;
  }

  // ─── Fluent config ──────────────────────────────────────────────────────

  baseUrl(url: string): this {
    this._baseUrl = normalizeBaseUrl(url);
    return this;
  }

  withHeaders(headers: HeadersInit): this {
    new Headers(headers).forEach((v, k) => this._headers.set(k, v));
    return this;
  }

  withHeader(name: string, value: string): this {
    this._headers.set(name, value);
    return this;
  }

  replaceHeaders(headers: HeadersInit): this {
    this._headers = new Headers(headers);
    return this;
  }

  accept(contentType: string): this {
    this._headers.set("Accept", contentType);
    return this;
  }

  acceptJson(): this {
    return this.accept("application/json");
  }

  contentType(type: string): this {
    this._headers.set("Content-Type", type);
    return this;
  }

  withToken(token: string, type = "Bearer"): this {
    this._headers.set("Authorization", `${type} ${token}`);
    return this;
  }

  withBasicAuth(username: string, password: string): this {
    this._headers.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
    return this;
  }

  asJson(): this {
    this._format = "json";
    return this;
  }

  asForm(): this {
    this._format = "form";
    return this;
  }

  asMultipart(): this {
    this._format = "multipart";
    return this;
  }

  attach(name: string, value: Blob | string, filename?: string): this {
    this._attachments.push({ name, value, filename });
    return this;
  }

  withBody(body: BodyInit, contentType: string): this {
    this._format = "raw";
    this._rawBody = body;
    this._rawContentType = contentType;
    return this;
  }

  withQueryParameters(params: Record<string, unknown>): this {
    Object.assign(this._queryParams, params);
    return this;
  }

  withUrlParameters(params: Record<string, string>): this {
    Object.assign(this._urlParams, params);
    return this;
  }

  withOptions(init: RequestInit & { fetch?: typeof globalThis.fetch }): this {
    const {
      fetch: fetchImpl,
      signal,
      ...rest
    } = init as RequestInit & {
      fetch?: typeof globalThis.fetch;
      signal?: AbortSignal;
    };
    if (fetchImpl) this._fetchImpl = fetchImpl;
    if (signal) this._signal = signal;
    this._extraInit = { ...this._extraInit, ...rest };
    return this;
  }

  timeout(seconds: number): this {
    this._timeout = seconds;
    return this;
  }

  connectTimeout(seconds: number): this {
    this._connectTimeout = seconds;
    return this;
  }

  retry(
    times: number,
    sleep?: RetryConfig["sleep"],
    when?: RetryConfig["when"],
    opts?: { throw?: boolean },
  ): this {
    this._retry = { times, sleep, when, throw: opts?.throw ?? true };
    return this;
  }

  withRequestMiddleware(fn: RequestMiddlewareFn): this {
    this._requestMiddleware.push(fn);
    return this;
  }

  withResponseMiddleware(fn: ResponseMiddlewareFn): this {
    this._responseMiddleware.push(fn);
    return this;
  }

  // ─── Terminal methods ────────────────────────────────────────────────────

  get(url: string, query?: Record<string, unknown>): Promise<HttpResponse> {
    if (query) this.withQueryParameters(query);
    return this._send("GET", url);
  }

  head(url: string): Promise<HttpResponse> {
    return this._send("HEAD", url);
  }

  post(url: string, data?: unknown): Promise<HttpResponse> {
    if (data !== undefined) this._bodyData = data;
    return this._send("POST", url);
  }

  put(url: string, data?: unknown): Promise<HttpResponse> {
    if (data !== undefined) this._bodyData = data;
    return this._send("PUT", url);
  }

  patch(url: string, data?: unknown): Promise<HttpResponse> {
    if (data !== undefined) this._bodyData = data;
    return this._send("PATCH", url);
  }

  delete(url: string, data?: unknown): Promise<HttpResponse> {
    if (data !== undefined) this._bodyData = data;
    return this._send("DELETE", url);
  }

  send(method: string, url: string): Promise<HttpResponse> {
    return this._send(method, url);
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private _buildUrl(path: string): string {
    const expanded =
      Object.keys(this._urlParams).length > 0 ? expandUrlTemplate(path, this._urlParams) : path;
    const isAbsolute = expanded.startsWith("http://") || expanded.startsWith("https://");
    const base = isAbsolute ? "" : this._baseUrl;
    const qs = buildQueryString(this._queryParams);
    return `${base}${expanded}${qs}`;
  }

  private _buildBody(method: string): { body: BodyInit | null; autoContentType: string | null } {
    const noBody = method === "GET" || method === "HEAD";
    if (noBody || this._bodyData === undefined) {
      if (this._format === "raw" && this._rawBody !== null) {
        return { body: this._rawBody, autoContentType: this._rawContentType };
      }
      if (this._format === "multipart" && this._attachments.length > 0) {
        const fd = new FormData();
        for (const { name, value, filename } of this._attachments) {
          if (filename && value instanceof Blob) {
            fd.append(name, value, filename);
          } else {
            fd.append(name, value instanceof Blob ? value : String(value));
          }
        }
        return { body: fd, autoContentType: null };
      }
      return { body: null, autoContentType: null };
    }

    switch (this._format) {
      case "json": {
        const json = JSON.stringify(this._bodyData);
        return { body: json, autoContentType: "application/json" };
      }
      case "form": {
        const params = new URLSearchParams();
        if (isPlainObject(this._bodyData)) {
          for (const [k, v] of Object.entries(this._bodyData)) {
            if (v !== undefined && v !== null) params.append(k, String(v));
          }
        }
        return { body: params, autoContentType: "application/x-www-form-urlencoded" };
      }
      case "multipart": {
        const fd = new FormData();
        if (isPlainObject(this._bodyData)) {
          for (const [k, v] of Object.entries(this._bodyData)) {
            if (v !== undefined && v !== null) fd.append(k, String(v));
          }
        }
        for (const { name, value, filename } of this._attachments) {
          if (filename && value instanceof Blob) {
            fd.append(name, value, filename);
          } else {
            fd.append(name, value instanceof Blob ? value : String(value));
          }
        }
        return { body: fd, autoContentType: null };
      }
      case "raw":
        return { body: this._rawBody, autoContentType: this._rawContentType };
    }
  }

  private _calcSleep(sleep: RetryConfig["sleep"], attempt: number, err: unknown): number {
    if (sleep === undefined) return 0;
    if (typeof sleep === "number") return sleep;
    if (Array.isArray(sleep)) return sleep[attempt - 1] ?? sleep[sleep.length - 1] ?? 0;
    return (sleep as (a: number, e: unknown) => number)(attempt, err);
  }

  private _bodyTextForRecord(): string {
    if (this._format === "raw" && this._rawBody !== null) {
      return typeof this._rawBody === "string" ? this._rawBody : "[binary]";
    }
    if (this._bodyData !== undefined) {
      try {
        return JSON.stringify(this._bodyData);
      } catch {
        return "";
      }
    }
    return "";
  }

  /**
   * Produce the `Request` to hand to the transport.
   *
   * Three cases, cheapest first:
   *  - no signal, no further attempts → send the original, no copy at all
   *  - a signal → one `new Request(...)` to attach it (this also consumes the
   *    source body, which is fine when nothing else will read it)
   *  - a further attempt is possible → `clone()` so the body stream survives
   */
  private _prepareOutgoing(
    request: Request,
    signal: AbortSignal | undefined,
    mayRetry: boolean,
  ): Request {
    const source = mayRetry ? request.clone() : request;
    return signal ? new Request(source, { signal }) : source;
  }

  private async _send(method: string, path: string): Promise<HttpResponse> {
    // ── Steps 1–3: resolve URL and body ──────────────────────────────────
    const url = this._buildUrl(path);
    const { body, autoContentType } = this._buildBody(method);
    const headers = mergeHeaders(
      _globalRequestInit.headers as HeadersInit | undefined,
      this._headers,
    );
    if (autoContentType && !headers.has("content-type")) {
      headers.set("content-type", autoContentType);
    }

    // ── Step 4: build native Request, run request middleware ──────────────
    let request = new Request(url, {
      ...this._extraInit,
      method,
      headers,
      body: body ?? undefined,
    });

    // Middleware lists are almost always empty. Concatenating them
    // unconditionally allocated two spreads plus a joined array on every
    // outgoing call, so only build the combined list when one side is
    // non-empty and reuse the populated side directly when the other is not.
    const reqMiddleware = joinMiddleware(_globalRequestMiddleware, this._requestMiddleware);
    for (const mw of reqMiddleware) {
      request = await mw(request);
    }

    // ── Steps 5–8: retry loop ─────────────────────────────────────────────
    const retryConfig = this._retry;
    const maxAttempts = retryConfig ? retryConfig.times + 1 : 1;
    // Hoisted out of the retry loop — the list cannot change between attempts,
    // so rebuilding it per attempt was pure allocation.
    const respMiddleware = joinMiddleware(_globalResponseMiddleware, this._responseMiddleware);
    let lastResponse: HttpResponse | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0 && retryConfig) {
        const ms = this._calcSleep(retryConfig.sleep, attempt, lastError);
        if (ms > 0) await this._sleeper(ms);
      }

      try {
        // ── Step 5: timeout signal ────────────────────────────────────────
        const timeoutSecs = this._timeout ?? this._connectTimeout;
        let signal: AbortSignal | undefined;
        if (timeoutSecs !== null) {
          const tsig = AbortSignal.timeout(timeoutSecs * 1000);
          signal = this._signal ? AbortSignal.any([this._signal, tsig]) : tsig;
        } else if (this._signal) {
          signal = this._signal;
        }

        // ── Step 6: resolve fetch ─────────────────────────────────────────
        let rawResponse: Response;
        const fakeActive = _isFakeActive();

        // `request` only has to survive the call when another attempt might
        // reuse it, so cloning is conditional on retries actually being
        // configured. A clone duplicates the body stream; paying for that on
        // every single-attempt call — the overwhelmingly common case — is
        // wasted work. `mayRetry` is computed per attempt because the last
        // attempt never needs a surviving original either.
        const mayRetry = attempt < maxAttempts - 1;
        const outgoing = this._prepareOutgoing(request, signal, mayRetry);

        if (fakeActive) {
          const isStrayPrevented = _isStrayPrevented();
          if (isStrayPrevented && !_isStrayAllowed(url)) {
            // Will throw inside _resolveFakeResponse for unmatched
          }
          rawResponse = await _resolveFakeResponse(outgoing);
          // Serializing the body for the recorder is only meaningful when a
          // fake is installed to record into. Computing it eagerly on the
          // real-transport path meant every POST paid a second full
          // `JSON.stringify` of its payload for a value nothing read.
          _recordFakeEntry(outgoing, this._bodyTextForRecord(), rawResponse);
        } else {
          const fetchFn = this._fetchImpl ?? globalThis.fetch;
          rawResponse = await fetchFn(outgoing);
        }

        // ── Step 8: response middleware + buffer ──────────────────────────
        let processedResponse = rawResponse;
        for (const mw of respMiddleware) {
          processedResponse = await mw(processedResponse);
        }

        const text = await processedResponse.text();
        const httpResponse = new HttpResponse(processedResponse, text);

        // Check if retry needed on response
        if (attempt < maxAttempts - 1 && retryConfig) {
          const shouldRetry = retryConfig.when
            ? retryConfig.when(httpResponse.toException() ?? null, request)
            : httpResponse.failed();
          if (shouldRetry) {
            lastResponse = httpResponse;
            lastError = null;
            continue;
          }
        }

        return httpResponse;
      } catch (err) {
        if (err instanceof ConnectionException) {
          lastError = err;
        } else if (
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError")
        ) {
          lastError = new ConnectionException("Request timed out", err);
        } else {
          lastError = new ConnectionException(
            err instanceof Error ? err.message : "Network request failed",
            err,
          );
        }

        if (attempt < maxAttempts - 1 && retryConfig) {
          const shouldRetry = retryConfig.when ? retryConfig.when(lastError, request) : true;
          if (shouldRetry) continue;
        }

        throw lastError;
      }
    }

    // Retries exhausted with a response
    if (lastResponse) {
      if (retryConfig?.throw !== false) {
        throw new RequestException(lastResponse);
      }
      return lastResponse;
    }

    throw lastError as Error;
  }
}
