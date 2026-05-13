import { Elysia } from "elysia";
import { Logger, createRequestLogger } from "../services/logger.service";
import { Container, globalContainer } from "../core/container";
import type { CompiledRouteDefinition } from "../core/router/router-execution-context";
import type { CorsOptions } from "../core/http-options";

// Resolve `Bun.randomUUIDv7` once at module load. Bun has shipped it since
// 1.1, so the cross-runtime fallback isn't worth the per-request lookup &
// try/catch cost. Falls back to `crypto.randomUUID` only if Bun isn't
// present (e.g. someone bundles this module into Node for type-checking).
const randomUUIDv7: () => string =
  typeof Bun !== "undefined" && typeof (Bun as any).randomUUIDv7 === "function"
    ? (Bun as any).randomUUIDv7.bind(Bun)
    : () => crypto.randomUUID();

interface ElysiaAdapterOptions {
  logger?: boolean;
  container?: Container;
}

interface CompiledCorsOptions {
  origin?: string | string[] | boolean;
  allowedOrigins?: Set<string>;
  fallbackOrigin?: string;
  staticHeaders: Record<string, string>;
}

// Per-context-store flag used to dedupe inflight counter increment/decrement
// without the cost of WeakSet add/has/delete on the `Request` object.
const INFLIGHT_COUNTED_KEY = "__bnestInflightCounted";

export class ElysiaAdapter {
  private app: Elysia;
  private logger: Logger;
  private container: Container;
  private requestStartTimes = new WeakMap<Request, number>();
  private compiledCorsOptions?: CompiledCorsOptions;
  private inflight = 0;
  private isDraining = false;

  constructor(private options?: ElysiaAdapterOptions) {
    this.container = options?.container || globalContainer;
    this.logger = new Logger("ElysiaAdapter");
    this.app = this.createApp();
  }

  public reset() {
    this.app = this.createApp();
  }

  public enableCors(options: CorsOptions = {}) {
    this.compiledCorsOptions = this.compileCorsOptions(options);
  }

  public getInflightCount(): number {
    return this.inflight;
  }

  public setDraining(value: boolean): void {
    this.isDraining = value;
  }

  public isDrainingRequests(): boolean {
    return this.isDraining;
  }

  public async waitForDrain(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.inflight > 0) {
      if (Date.now() >= deadline) {
        return this.inflight === 0;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return true;
  }

  private createApp() {
    const app = new Elysia();
    this.setupInflightTracking(app);
    this.setupRequestLogging(app);
    this.setupCors(app);
    return app;
  }

  private setupInflightTracking(app: Elysia) {
    app.onRequest((ctx: any) => {
      if (this.isDraining) {
        return new Response(null, {
          status: 503,
          headers: { connection: "close" },
        });
      }
      const store = ctx.store ?? (ctx.store = {});
      if (!store[INFLIGHT_COUNTED_KEY]) {
        store[INFLIGHT_COUNTED_KEY] = true;
        this.inflight++;
      }
    });

    const release = (ctx: any) => {
      const store = ctx.store;
      if (store && store[INFLIGHT_COUNTED_KEY]) {
        store[INFLIGHT_COUNTED_KEY] = false;
        if (this.inflight > 0) this.inflight--;
      }
    };

    app.onAfterHandle((ctx: any) => {
      release(ctx);
    });

    app.onError((ctx: any) => {
      release(ctx);
    });
  }

  private setupRequestLogging(app: Elysia) {
    const loggingEnabled = this.options?.logger !== false;

    // The request-id hook must run even when request logging is disabled,
    // because downstream code (mapException, the RFC 7807 problem document,
    // controllers reading `store.requestId`) relies on the id being present.
    // The `error-contract` test suite asserts this behavior with
    // `logger: false`, so we cannot skip the block entirely.
    //
    // We do, however, skip the `requestStartTimes` bookkeeping when logging
    // is off: the start time is only consumed inside the logging callbacks.
    app.onRequest((ctx: any) => {
      const request = ctx.request;
      const inbound = request.headers.get("x-request-id");
      const requestId =
        typeof inbound === "string" && inbound.length > 0 ? inbound : randomUUIDv7();
      const store = ctx.store ?? (ctx.store = {});
      store.requestId = requestId;
      if (loggingEnabled) {
        this.requestStartTimes.set(request, performance.now());
      }
    });

    if (!loggingEnabled) {
      // Logging suppressed — but we still echo `x-request-id` so clients can
      // correlate requests. No `requestStartTimes` to clean up.
      app.onAfterHandle((ctx: any) => {
        this.echoRequestId(ctx);
      });
      app.onError((ctx: any) => {
        this.echoRequestId(ctx);
      });
      return;
    }

    app.onAfterHandle((ctx: any) => {
      const { request, set } = ctx;
      const start = this.requestStartTimes.get(request) || performance.now();
      const duration = Math.round(performance.now() - start);
      const path = this.getRequestPath(request.url);
      const requestId = ctx.store?.requestId as string | undefined;
      const requestLogger = requestId ? createRequestLogger(requestId, "HTTP") : this.logger;
      requestLogger.log(`${request.method} ${path} ${set.status || 200} +${duration}ms`, "HTTP");
      this.echoRequestId(ctx);
      this.requestStartTimes.delete(request);
    });

    app.onError((ctx: any) => {
      const { request, code, error, set } = ctx;
      const start = this.requestStartTimes.get(request) || performance.now();
      const duration = Math.round(performance.now() - start);
      const path = this.getRequestPath(request.url);
      const stack = error instanceof Error ? error.stack : undefined;
      const requestId = ctx.store?.requestId as string | undefined;
      const requestLogger = requestId ? createRequestLogger(requestId, "HTTP") : this.logger;
      requestLogger.error(
        `${request.method} ${path} ${set.status || 500} +${duration}ms (${code})`,
        stack,
        "HTTP",
      );
      this.echoRequestId(ctx);
      this.requestStartTimes.delete(request);
    });
  }

  private echoRequestId(ctx: any): void {
    const requestId = ctx?.store?.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) return;
    const set = ctx.set;
    if (!set) return;
    const existing = set.headers ?? {};
    if (existing instanceof Headers) {
      existing.set("x-request-id", requestId);
      set.headers = existing;
    } else {
      set.headers = {
        ...(existing as Record<string, string>),
        "x-request-id": requestId,
      };
    }
  }

  private setupCors(app: Elysia) {
    if (!this.compiledCorsOptions) {
      return;
    }

    app.onRequest(({ request }) => {
      if (request.method !== "OPTIONS") return;
      return new Response(null, {
        status: 204,
        headers: this.createCorsHeaders(request),
      });
    });

    app.onAfterHandle(({ request, set }) => {
      const headers = this.createCorsHeaders(request);
      set.headers = {
        ...this.normalizeHeaders(set.headers || {}),
        ...this.normalizeHeaders(headers),
      };
    });
  }

  public registerRoutes(routes: CompiledRouteDefinition[]) {
    for (const route of routes) {
      const elysiaMethod = route.method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "patch"
        | "delete";

      const elysiaOptions: any = {};
      if (route.schema) {
        if (route.schema.body) elysiaOptions.body = route.schema.body;
        if (route.schema.query) elysiaOptions.query = route.schema.query;
        if (route.schema.params) elysiaOptions.params = route.schema.params;
        if (route.schema.response) elysiaOptions.response = route.schema.response;
      }

      if (route.beforeHandle && route.beforeHandle.length > 0) {
        elysiaOptions.beforeHandle = route.beforeHandle;
      }

      (this.app as any)[elysiaMethod](route.fullPath, route.handler, elysiaOptions);

      if (this.options?.logger !== false) {
        this.logger.debug(`Mapped {${route.fullPath}, ${route.method}} route`, "Router");
      }
    }
  }

  public getContainer() {
    return this.container;
  }

  public getInstance() {
    return this.app;
  }

  private createCorsHeaders(request: Request): HeadersInit {
    const cors = this.compiledCorsOptions;
    if (!cors) return {};

    const origin = request.headers.get("origin");
    const allowedOrigin = Array.isArray(cors.origin)
      ? origin && cors.allowedOrigins?.has(origin)
        ? origin
        : cors.fallbackOrigin
      : cors.origin === true || cors.origin === undefined
        ? (origin ?? "*")
        : typeof cors.origin === "string"
          ? cors.origin
          : "*";

    return {
      "access-control-allow-origin": allowedOrigin ?? "*",
      ...cors.staticHeaders,
    };
  }

  private compileCorsOptions(options: CorsOptions): CompiledCorsOptions {
    const staticHeaders: Record<string, string> = {
      "access-control-allow-methods": (
        options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
      ).join(","),
      "access-control-allow-headers": (
        options.allowedHeaders ?? ["Content-Type", "Authorization", "X-Version"]
      ).join(","),
    };

    if (options.exposedHeaders) {
      staticHeaders["access-control-expose-headers"] = options.exposedHeaders.join(",");
    }
    if (options.credentials) {
      staticHeaders["access-control-allow-credentials"] = "true";
    }
    if (options.maxAge !== undefined) {
      staticHeaders["access-control-max-age"] = `${options.maxAge}`;
    }

    return {
      origin: options.origin,
      allowedOrigins: Array.isArray(options.origin) ? new Set(options.origin) : undefined,
      fallbackOrigin: Array.isArray(options.origin) ? options.origin[0] : undefined,
      staticHeaders,
    };
  }

  private normalizeHeaders(
    headers: HeadersInit | Record<string, unknown>,
  ): Record<string, string | number> {
    const normalized: Record<string, string | number> = {};

    if (headers instanceof Headers) {
      for (const [key, value] of headers.entries()) {
        normalized[key] = value;
      }
      return normalized;
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        normalized[key] = value;
      }
      return normalized;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string" || typeof value === "number") {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        normalized[key] = value.join(",");
      }
    }

    return normalized;
  }

  private getRequestPath(url: string): string {
    const protocolIndex = url.indexOf("://");
    if (protocolIndex === -1) {
      return url;
    }

    const pathStart = url.indexOf("/", protocolIndex + 3);
    if (pathStart === -1) {
      return "/";
    }

    const queryStart = url.indexOf("?", pathStart);
    return queryStart === -1 ? url.slice(pathStart) : url.slice(pathStart, queryStart);
  }
}
