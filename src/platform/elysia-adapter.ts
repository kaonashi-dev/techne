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
  shutdown?: {
    gracePeriod?: number;
  };
  validation?: {
    /**
     * When true, the validation error response includes every error
     * reported by the schema (the legacy behavior). When false/undefined
     * (default), only the first error is returned. Materializing every
     * error forces TypeBox to walk the whole iterator on every invalid
     * request and dominates the invalid-body throughput.
     */
    exhaustive?: boolean;
  };
  /**
   * Force-enable (or force-disable) the request-id pipeline. When unset we
   * derive it from `logger` + presence of an RFC 7807 exception filter. See
   * {@link ElysiaAdapter.computeNeedsRequestId}.
   */
  requestId?: boolean;
  /**
   * Set to `true` when an RFC 7807 problem-document filter is wired in
   * downstream (default in Techne via `RouterResponseController`). When true,
   * the request-id hook is registered so problem responses can stamp the id.
   */
  hasProblemFilter?: boolean;
}

interface CompiledCorsOptions {
  origin?: string | string[] | boolean;
  allowedOrigins?: Set<string>;
  fallbackOrigin?: string;
  staticHeaders: Record<string, string>;
  staticCorsHeaders?: Record<string, string>;
}

// Per-context-store flag used to dedupe inflight counter increment/decrement
// without the cost of WeakSet add/has/delete on the `Request` object.
const INFLIGHT_COUNTED_KEY = "__techneInflightCounted";

// Hoisted to module scope so the validation error path doesn't allocate a
// fresh headers object per request. Only the `set.headers == null` branch
// can share the constant — the mutation branches still have to touch the
// existing Headers/Record in place.
const PROBLEM_JSON_HEADERS: Record<string, string> = {
  "content-type": "application/problem+json",
};

export class ElysiaAdapter {
  private app: Elysia;
  private logger: Logger;
  private container: Container;
  private requestStartTimes = new WeakMap<Request, number>();
  private compiledCorsOptions?: CompiledCorsOptions;
  private corsHooksInstalled = false;
  private inflight = 0;
  private isDraining = false;
  private readonly trackInflight: boolean;
  private readonly loggerEnabled: boolean;
  /**
   * Boot-time gate for the request-id pipeline. When `false`, the full
   * `onRequest` request-id hook is skipped (no UUID allocation, no
   * `ctx.store` mutation). We still echo an inbound `x-request-id` header
   * via a tiny dedicated hook so clients keep correlation when they ask
   * for it. See {@link computeNeedsRequestId}.
   */
  private readonly needsRequestId: boolean;

  constructor(private options?: ElysiaAdapterOptions) {
    this.container = options?.container || globalContainer;
    this.logger = new Logger("ElysiaAdapter");
    this.trackInflight = options?.shutdown?.gracePeriod !== 0;
    this.loggerEnabled = options?.logger !== false;
    this.needsRequestId = ElysiaAdapter.computeNeedsRequestId(options, this.loggerEnabled);
    this.app = this.createApp();
  }

  /**
   * `needsRequestId` is true when at least one consumer reads the id:
   *  - request logging is on (the HTTP access log prefixes every line with it),
   *  - an RFC 7807 problem-document filter is installed (it stamps `requestId`
   *    on every error body; in Techne the default `RouterResponseController`
   *    qualifies, so callers pass `hasProblemFilter: true`),
   *  - the user explicitly opted in via `options.requestId === true`.
   * `options.requestId === false` is a hard opt-out for callers who know they
   * have no consumers (e.g. embedded micro-services behind a proxy that owns
   * correlation).
   */
  private static computeNeedsRequestId(
    options: ElysiaAdapterOptions | undefined,
    loggerEnabled: boolean,
  ): boolean {
    if (options?.requestId === false) return false;
    if (options?.requestId === true) return true;
    if (loggerEnabled) return true;
    if (options?.hasProblemFilter !== false) return true;
    return false;
  }

  public reset() {
    this.app = this.createApp();
  }

  public enableCors(options: CorsOptions = {}) {
    this.compiledCorsOptions = this.compileCorsOptions(options);
    this.setupCors(this.app);
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
    this.corsHooksInstalled = false;
    this.installFusedHooks(app);
    this.setupCors(app);
    return app;
  }

  /**
   * Installs the fused per-phase hooks. Replaces the historical 1-per-feature
   * registration pattern (inflight + request-id + logging + validation) with
   * a single monomorphic callback per phase whose body is composed once at
   * boot from the active feature flags. Each callback sees only one ctx shape
   * (Elysia's request context), so V8 keeps the call-site monomorphic.
   *
   * Phases with zero active branches don't register at all — keeps the
   * Elysia hook chain length proportional to the actual feature surface.
   *
   * User plugins still call `adapter.getInstance().onRequest()` etc. and
   * chain after ours; the fusion only collapses first-party hooks.
   */
  private installFusedHooks(app: Elysia) {
    const trackInflight = this.trackInflight;
    const needsRequestId = this.needsRequestId;
    const loggingEnabled = this.loggerEnabled;
    const exhaustive = this.options?.validation?.exhaustive === true;
    // `setupInflightTracking` historically registered an `onRequest` even
    // when `!trackInflight` purely to short-circuit drains during graceful
    // shutdown. The drain check is independent of counting, so it stays on
    // unconditionally.
    const onRequestActive = true;
    const onAfterHandleActive = trackInflight || needsRequestId;
    const onErrorActive = true; // validation error mapping is always-on

    if (onRequestActive) {
      app.onRequest((ctx: any) => {
        if (this.isDraining) {
          return new Response(null, {
            status: 503,
            headers: { connection: "close" },
          });
        }

        // Inflight: increment counter on first sight of this ctx.
        if (trackInflight) {
          const store = ctx.store ?? (ctx.store = {});
          if (!store[INFLIGHT_COUNTED_KEY]) {
            store[INFLIGHT_COUNTED_KEY] = true;
            this.inflight++;
          }
        }

        // Request-id: lazily install the UUID accessor (or copy inbound
        // header through) so consumers can read `ctx.store.requestId`
        // without paying the UUID cost when nobody asks. Logging start
        // time is captured here as well to keep the read paths together.
        if (needsRequestId) {
          const request = ctx.request;
          const inbound = request.headers.get("x-request-id");
          const store = ctx.store ?? (ctx.store = {});
          if (typeof inbound === "string" && inbound.length > 0) {
            store.requestId = inbound;
          } else {
            ElysiaAdapter.installLazyRequestId(store);
          }
          if (loggingEnabled) {
            this.requestStartTimes.set(request, performance.now());
          }
        }
      });
    }

    if (onAfterHandleActive) {
      app.onAfterHandle((ctx: any) => {
        if (trackInflight) {
          const store = ctx.store;
          if (store && store[INFLIGHT_COUNTED_KEY]) {
            store[INFLIGHT_COUNTED_KEY] = false;
            if (this.inflight > 0) this.inflight--;
          }
        }

        if (needsRequestId) {
          if (loggingEnabled) {
            const { request, set } = ctx;
            const start = this.requestStartTimes.get(request) || performance.now();
            const duration = Math.round(performance.now() - start);
            const path = this.getRequestPath(request.url);
            const requestId = ctx.store?.requestId as string | undefined;
            const requestLogger = requestId ? createRequestLogger(requestId, "HTTP") : this.logger;
            requestLogger.log(
              `${request.method} ${path} ${set.status || 200} +${duration}ms`,
              "HTTP",
            );
            this.echoRequestId(ctx);
            this.requestStartTimes.delete(request);
          } else {
            this.echoRequestId(ctx);
          }
        } else {
          // request-id pipeline disabled — still echo inbound header so
          // clients that opt in to correlation see their id reflected.
          this.echoInboundRequestId(ctx);
        }
      });
    }

    if (onErrorActive) {
      app.onError((ctx: any) => {
        if (trackInflight) {
          const store = ctx.store;
          if (store && store[INFLIGHT_COUNTED_KEY]) {
            store[INFLIGHT_COUNTED_KEY] = false;
            if (this.inflight > 0) this.inflight--;
          }
        }

        if (needsRequestId) {
          if (loggingEnabled) {
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
          } else {
            this.echoRequestId(ctx);
          }
        } else {
          this.echoInboundRequestId(ctx);
        }

        // Validation error mapping — runs last so any header echo above is
        // preserved, and we return the problem+json body that Elysia uses
        // as the response.
        if (ctx.code !== "VALIDATION") return;
        const { error, set } = ctx;
        set.status = 422;
        const existing = set.headers;
        if (existing == null) {
          set.headers = PROBLEM_JSON_HEADERS;
        } else if (existing instanceof Headers) {
          existing.set("content-type", "application/problem+json");
        } else {
          (existing as Record<string, string>)["content-type"] = "application/problem+json";
        }

        let errors: unknown[];
        if (exhaustive) {
          errors = error?.all ?? [];
        } else {
          // Default fast path: avoid Elysia's `error.all` getter, which
          // spreads the entire TypeBox `Errors(...)` iterator. Prefer the
          // first-error fields the ValidationError already stores on the
          // instance.
          const first = error?.first ?? error?.valueError ?? error?.messageValue ?? error?.all?.[0];
          errors = first ? [first] : [];
        }

        return {
          type: "https://httpstatuses.com/422",
          title: "Unprocessable Entity",
          status: 422,
          errors,
        };
      });
    }
  }

  /**
   * Attaches a lazy `requestId` accessor to `store`. The UUID is generated
   * on first read and the property is then replaced with a plain string so
   * subsequent reads are a property lookup with no getter call.
   */
  private static installLazyRequestId(store: Record<string, unknown>): void {
    Object.defineProperty(store, "requestId", {
      configurable: true,
      enumerable: true,
      get() {
        const id = randomUUIDv7();
        Object.defineProperty(store, "requestId", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: id,
        });
        return id;
      },
      set(value: unknown) {
        Object.defineProperty(store, "requestId", {
          configurable: true,
          enumerable: true,
          writable: true,
          value,
        });
      },
    });
  }

  /**
   * Echoes an inbound `x-request-id` header back on the response without
   * ever touching `ctx.store`. Used when `needsRequestId` is false: we still
   * want clients that opt in to correlation to see their id reflected.
   */
  private echoInboundRequestId(ctx: any): void {
    const inbound = ctx?.request?.headers?.get?.("x-request-id");
    if (typeof inbound !== "string" || inbound.length === 0) return;
    const set = ctx.set;
    if (!set) return;
    const existing = set.headers;
    if (existing == null) {
      set.headers = { "x-request-id": inbound };
    } else if (existing instanceof Headers) {
      existing.set("x-request-id", inbound);
    } else {
      (existing as Record<string, string>)["x-request-id"] = inbound;
    }
  }

  private echoRequestId(ctx: any): void {
    const requestId = ctx?.store?.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) return;
    const set = ctx.set;
    if (!set) return;
    const existing = set.headers;
    if (existing == null) {
      set.headers = { "x-request-id": requestId };
    } else if (existing instanceof Headers) {
      existing.set("x-request-id", requestId);
    } else {
      (existing as Record<string, string>)["x-request-id"] = requestId;
    }
  }

  private setupCors(app: Elysia) {
    if (!this.compiledCorsOptions || this.corsHooksInstalled) {
      return;
    }
    this.corsHooksInstalled = true;

    app.onRequest(({ request }) => {
      if (request.method !== "OPTIONS") return;
      return new Response(null, {
        status: 204,
        headers: this.createCorsHeaders(request),
      });
    });

    app.onAfterHandle(({ request, set }) => {
      const cors = this.createCorsHeaders(request) as Record<string, string>;
      const existing = set.headers;
      if (existing == null) {
        set.headers = cors;
      } else if (existing instanceof Headers) {
        for (const [k, v] of Object.entries(cors)) existing.set(k, v);
      } else {
        const h = existing as Record<string, string | number>;
        for (const [k, v] of Object.entries(cors)) h[k] = v;
      }
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
    if (cors.staticCorsHeaders) return cors.staticCorsHeaders;

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

    const staticOrigin =
      typeof options.origin === "string"
        ? options.origin
        : options.origin === false
          ? "*"
          : undefined;
    const staticCorsHeaders =
      staticOrigin === undefined
        ? undefined
        : {
            "access-control-allow-origin": staticOrigin,
            ...staticHeaders,
          };

    return {
      origin: options.origin,
      allowedOrigins: Array.isArray(options.origin) ? new Set(options.origin) : undefined,
      fallbackOrigin: Array.isArray(options.origin) ? options.origin[0] : undefined,
      staticHeaders,
      staticCorsHeaders,
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
