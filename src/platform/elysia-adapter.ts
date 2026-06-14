import { Elysia } from "elysia";
import { Logger, requestContext, type RequestContext } from "../services/logger.service";
import { Container, globalContainer } from "../core/container";
import type { CompiledRouteDefinition } from "../core/router/router-execution-context";
import type { CookieOptions, CorsOptions } from "../core/http-options";
import { applyHeader, applyHeaders } from "./headers";
import type { CompiledRateLimitPolicy, RateLimitDecision } from "../security/rate-limit";
import { resolveClientIp } from "../security/client-ip";
import { RouterResponseController } from "../core/router/router-response-controller";
import { TooManyRequestsException } from "../exceptions";

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
  /**
   * Boot-compiled security response headers (lowercase names), produced by
   * `compileSecurityHeaders()`. When present, stamped on every response in
   * the fused `onAfterHandle`/`onError` hooks. Raw `Response` short-circuits
   * (CORS preflight 204, draining 503) bypass those hooks and intentionally
   * skip these headers.
   */
  securityHeaders?: Readonly<Record<string, string>>;
  /**
   * Compiled global rate-limit policy, produced by `compileRateLimitPolicy()`.
   * When present, evaluated in the fused `onRequest` hook after the drain
   * check. When absent, zero hooks and zero per-request cost.
   */
  rateLimit?: CompiledRateLimitPolicy;
  /**
   * Cookie signing configuration forwarded to the Elysia constructor.
   * Elysia's built-in cookie jar signs/verifies cookies whose names appear
   * in `sign` using HMAC-SHA256 with the provided `secrets`.
   */
  cookies?: CookieOptions;
}

interface CompiledCorsOptions {
  origin?: string | string[] | boolean;
  allowedOrigins?: Set<string>;
  fallbackOrigin?: string;
  staticHeaders: Record<string, string>;
  staticCorsHeaders?: Record<string, string>;
  dynamicHeadersCache?: Map<string, Record<string, string>>;
  dynamicHeadersMaxEntries: number;
}

/**
 * Per-request store shape allocated at the top of the fused `onRequest`
 * hook. Giving every request a single, monomorphic store object up-front
 * lets V8 pin one hidden class for every `ctx.store.*` read/write across
 * the hot hook paths, instead of the megamorphic `ctx.store ?? (ctx.store
 * = {})` coalesce + dynamic property add that used to happen on first
 * touch (Plan A6). `app.derive` was the original target, but Elysia runs
 * derive as a transform *after* `onRequest`, so it can't pre-shape the
 * store for our own first hook — we do the assignment inline instead.
 */
interface TechneRequestStore {
  /**
   * Request-id field. Stays `undefined` when nobody asks (no inbound header,
   * no consumer reads it). When `needsRequestId` is on we either copy the
   * inbound `x-request-id` here or install a lazy getter that mints a UUID
   * on first read and self-replaces with the materialized string. The lazy
   * getter also syncs the id into the ALS request context so loggers that
   * read from ALS pick it up without a per-request Logger allocation (L11).
   */
  requestId: string | undefined;
  /**
   * Request start timestamp captured with `Bun.nanoseconds()` when HTTP
   * logging is enabled. Lives on the request store so logging avoids a
   * WeakMap set/get/delete on every request.
   */
  startUs: number | undefined;
  /**
   * Dedup flag for the inflight counter so we increment in `onRequest` and
   * decrement once in either `onAfterHandle` or `onError`, never both. Lives
   * on the store (not a WeakSet keyed by `Request`) to avoid add/has/delete
   * traffic on the global WeakMap.
   */
  inflightCounted: boolean;
  /** W3C traceparent trace-id (32 hex chars), if the inbound header was present (L12). */
  traceId: string | undefined;
  /** W3C traceparent parent-id / span-id (16 hex chars) (L12). */
  spanId: string | undefined;
  /**
   * Rate-limit decision from the global limiter's `onRequest` check.
   * Stashed here so `onAfterHandle` can inject `RateLimit-Remaining` without
   * a second store lookup. `undefined` when no limiter is configured, the
   * route is excluded, or no key was resolvable.
   */
  rateLimitDecision: RateLimitDecision | undefined;
}

// Hoisted to module scope so the validation error path doesn't allocate a
// fresh headers object per request. Only the `set.headers == null` branch
// can share the constant — the mutation branches still have to touch the
// existing Headers/Record in place.
const PROBLEM_JSON_HEADERS: Record<string, string> = {
  "content-type": "application/problem+json",
};

/**
 * Parse a W3C `traceparent` header into traceId + spanId (L12).
 * Format: `version-traceId-parentId-flags` where version="00",
 * traceId=32 hex chars, parentId=16 hex chars.
 */
export function parseTraceparent(header: string | null): { traceId?: string; spanId?: string } {
  if (!header) return {};
  const parts = header.split("-");
  if (parts.length !== 4 || parts[0] !== "00") return {};
  const [, traceId, spanId] = parts;
  if (!/^[0-9a-f]{32}$/.test(traceId) || !/^[0-9a-f]{16}$/.test(spanId)) return {};
  return { traceId, spanId };
}

export class ElysiaAdapter {
  private app: Elysia;
  private logger: Logger;
  private container: Container;
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
  /** One-time "no IP resolvable" warning when using `app.handle()` without sockets. */
  private warnedNoIp = false;
  /**
   * Compiled matcher for paths exempted from the global limiter via
   * `@RateLimit` decorators. `undefined` until the first exemption arrives,
   * so the common no-decorator case pays a single undefined check.
   */
  private rateLimitExemptPattern?: RegExp;
  /** Maps limiter denials to canonical RFC 7807 problem documents. */
  private readonly problemMapper = new RouterResponseController();

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

  /**
   * Registers route paths the global rate limiter must skip. Called at
   * route-registration time by `RoutesResolver` for every route carrying a
   * `@RateLimit` decorator: `@RateLimit(false)` exempts the route entirely,
   * and `@RateLimit({...})` routes are governed solely by their per-route
   * policy — running the global limiter too would double-count and silently
   * cap looser per-route limits.
   *
   * Paths match exactly, with `:param` segments matching any single path
   * segment. Exemption is per-path, so it applies to every HTTP method
   * registered on that path. No-op when no rate limiter is configured.
   */
  public addRateLimitExemptions(paths: string[]): void {
    if (!this.options?.rateLimit || paths.length === 0) return;
    const alternatives: string[] = [];
    if (this.rateLimitExemptPattern) {
      // Strip the `^(?:` ... `)$` wrapper to merge prior alternatives.
      alternatives.push(this.rateLimitExemptPattern.source.slice(4, -2));
    }
    for (const path of paths) {
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      alternatives.push(escaped.replace(/:[A-Za-z0-9_]+/g, "[^/]+"));
    }
    this.rateLimitExemptPattern = new RegExp(`^(?:${alternatives.join("|")})$`);
  }

  private createApp() {
    const cookieConfig = this.options?.cookies;
    const elysiaInit: Record<string, unknown> = {};
    if (cookieConfig?.secrets || cookieConfig?.sign) {
      elysiaInit.cookie = {
        ...(cookieConfig.secrets !== undefined ? { secrets: cookieConfig.secrets } : {}),
        ...(cookieConfig.sign !== undefined ? { sign: cookieConfig.sign } : {}),
      };
    }
    const app = Object.keys(elysiaInit).length > 0 ? new Elysia(elysiaInit as any) : new Elysia();
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
    const securityHeaders = this.options?.securityHeaders;
    const rateLimitPolicy = this.options?.rateLimit;
    // `setupInflightTracking` historically registered an `onRequest` even
    // when `!trackInflight` purely to short-circuit drains during graceful
    // shutdown. The drain check is independent of counting, so it stays on
    // unconditionally.
    const onRequestActive = true;
    const onAfterHandleActive =
      trackInflight ||
      needsRequestId ||
      securityHeaders !== undefined ||
      rateLimitPolicy !== undefined;
    const onErrorActive = true; // validation error mapping is always-on

    const needsStore = trackInflight || needsRequestId || rateLimitPolicy !== undefined;

    if (onRequestActive) {
      // The core stays synchronous: apps without a rate limiter register it
      // directly so they never pay promise allocation in the hottest hook
      // (zero-cost contract). The async wrapper below is registered only
      // when a limiter is configured.
      const onRequestCore = (ctx: any): Response | undefined => {
        if (this.isDraining) {
          return new Response(null, {
            status: 503,
            headers: { connection: "close" },
          });
        }

        // Pre-shape `ctx.store` once per request with the full Techne field
        // set. Every downstream hook (this fused chain + any user plugins
        // reading `ctx.store.requestId`) now sees the same monomorphic
        // hidden class, instead of the historical `ctx.store ?? (ctx.store
        // = {})` coalesce + dynamic property add that put the call sites
        // into megamorphic land. `app.derive` runs as a transform after
        // onRequest in Elysia's compose order, so the derive idiom can't
        // pre-shape the store for *this* hook — we do it inline here.
        // Skipped entirely when neither tracking flag is on (nothing reads
        // the store in that case).
        if (needsStore) {
          const request = ctx.request;

          // L12: parse W3C traceparent before building the store so traceId
          // and spanId are available when we enter the ALS context below.
          const { traceId, spanId } = parseTraceparent(request.headers.get("traceparent"));

          const store: TechneRequestStore = {
            requestId: undefined,
            startUs: undefined,
            inflightCounted: false,
            traceId,
            spanId,
            rateLimitDecision: undefined,
          };
          ctx.store = store;

          if (trackInflight) {
            store.inflightCounted = true;
            this.inflight++;
          }

          // L5: enter the ALS request context so loggers running anywhere in
          // this async execution chain can read requestId/traceId without
          // a per-request Logger allocation.
          if (needsRequestId) {
            const inbound = request.headers.get("x-request-id");
            // Mutable context object — the lazy getter below writes requestId
            // into it the first time the id is read anywhere in the request.
            const reqCtx: RequestContext = {
              requestId: undefined,
              traceId,
              spanId,
            };
            requestContext.enterWith(reqCtx);

            if (typeof inbound === "string" && inbound.length > 0) {
              store.requestId = inbound;
              reqCtx.requestId = inbound;
            } else {
              // Lazy UUID: generate on first read, then self-replace both on
              // the store and in the ALS context so the id is visible everywhere.
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
                  reqCtx.requestId = id;
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

            if (loggingEnabled) {
              store.startUs = Bun.nanoseconds();
            }
          }
        }
        return undefined;
      };

      if (rateLimitPolicy) {
        // `needsStore` is always true here, so `ctx.store` is shaped by the
        // core before the limiter reads it.
        app.onRequest(async (ctx: any) => {
          const early = onRequestCore(ctx);
          if (early !== undefined) return early;
          return this.applyRateLimit(ctx, ctx.store as TechneRequestStore, rateLimitPolicy);
        });
      } else {
        app.onRequest(onRequestCore);
      }
    }

    if (onAfterHandleActive) {
      app.onAfterHandle((ctx: any) => {
        // Security headers go first: applyHeaders copies on the null branch,
        // so the request-id echo below can keep mutating in place.
        if (securityHeaders) {
          applyHeaders(ctx.set, securityHeaders);
        }

        // Inject RateLimit-* success headers when the limiter is active.
        if (rateLimitPolicy && rateLimitPolicy.headers) {
          const store = ctx.store as TechneRequestStore | undefined;
          const decision = store?.rateLimitDecision;
          if (decision) {
            applyHeader(ctx.set, "ratelimit-limit", String(decision.limit));
            applyHeader(ctx.set, "ratelimit-remaining", String(decision.remaining));
            applyHeader(ctx.set, "ratelimit-reset", String(Math.ceil(decision.resetMs / 1000)));
          }
        }

        if (trackInflight) {
          const store = ctx.store as TechneRequestStore;
          if (store.inflightCounted) {
            store.inflightCounted = false;
            if (this.inflight > 0) this.inflight--;
          }
        }

        if (needsRequestId) {
          if (loggingEnabled) {
            const { request, set } = ctx;
            const store = ctx.store as TechneRequestStore;
            const start = store.startUs ?? Bun.nanoseconds();
            const duration = Math.round((Bun.nanoseconds() - start) / 1_000_000);
            const path = this.getRequestPath(request.url);
            // L11: read store.requestId to trigger lazy UUID generation and sync
            // to ALS context; this.logger.log() then picks up requestId from ALS
            // instead of requiring a per-request Logger allocation.
            const requestId = store.requestId;
            const als = requestContext.getStore();
            if (als && requestId && !als.requestId) als.requestId = requestId;
            this.logger.log(
              `${request.method} ${path} ${set.status || 200} +${duration}ms`,
              "HTTP",
            );
            this.echoRequestId(ctx);
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
        // Stamp security headers on the error path too — error responses
        // (404s included) bypass `onAfterHandle` and need them most.
        if (securityHeaders) {
          applyHeaders(ctx.set, securityHeaders);
        }

        if (trackInflight) {
          const store = ctx.store as TechneRequestStore | undefined;
          if (store && store.inflightCounted) {
            store.inflightCounted = false;
            if (this.inflight > 0) this.inflight--;
          }
        }

        if (needsRequestId) {
          if (loggingEnabled) {
            const { request, code, error, set } = ctx;
            const store = ctx.store as TechneRequestStore | undefined;
            const start = store?.startUs ?? Bun.nanoseconds();
            const duration = Math.round((Bun.nanoseconds() - start) / 1_000_000);
            const path = this.getRequestPath(request.url);
            const stack = error instanceof Error ? error.stack : undefined;
            // L11: sync requestId to ALS context so this.logger picks it up.
            const requestId = store?.requestId;
            const als = requestContext.getStore();
            if (als && requestId && !als.requestId) als.requestId = requestId;
            this.logger.error(
              `${request.method} ${path} ${set.status || 500} +${duration}ms (${code})`,
              stack,
              "HTTP",
            );
            this.echoRequestId(ctx);
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
   * Echoes an inbound `x-request-id` header back on the response without
   * ever touching `ctx.store`. Used when `needsRequestId` is false: we still
   * want clients that opt in to correlation to see their id reflected.
   */
  private echoInboundRequestId(ctx: any): void {
    const inbound = ctx?.request?.headers?.get?.("x-request-id");
    if (typeof inbound !== "string" || inbound.length === 0) return;
    if (!ctx.set) return;
    applyHeader(ctx.set, "x-request-id", inbound);
  }

  private echoRequestId(ctx: any): void {
    const requestId = ctx?.store?.requestId;
    if (typeof requestId !== "string" || requestId.length === 0) return;
    if (!ctx.set) return;
    applyHeader(ctx.set, "x-request-id", requestId);
  }

  /**
   * Applies the global rate limit for a single request. Returns a 429
   * `Response` when the limit is exceeded, or `undefined` when the request
   * is allowed (or excluded / no-IP). Stashes the `RateLimitDecision` on
   * `ctx.store.rateLimitDecision` so `onAfterHandle` can inject headers
   * without a second store lookup.
   */
  private async applyRateLimit(
    ctx: any,
    store: TechneRequestStore,
    policy: CompiledRateLimitPolicy,
  ): Promise<Response | undefined> {
    // Routes opted out via @RateLimit decorators: exact path match with
    // `:param` segments wild. Checked before the user exclusions because
    // decorator metadata is the more specific signal.
    const path = this.getRequestPath(ctx.request.url);
    const exemptPattern = this.rateLimitExemptPattern;
    if (exemptPattern !== undefined && exemptPattern.test(path)) return undefined;
    // User-configured exclusions (prefix match, e.g. health endpoints).
    for (const prefix of policy.exclude) {
      if (path.startsWith(prefix)) return undefined;
    }

    // Resolve key.
    let key = policy.keyExtractor(ctx);
    if (key === undefined) {
      key = resolveClientIp(ctx, policy.trustProxy);
    }
    if (key === undefined) {
      // No IP resolvable (app.handle path without socket): fail-open.
      if (!this.warnedNoIp) {
        this.warnedNoIp = true;
        this.logger.warn(
          "Rate limiter could not resolve a client IP — request allowed (fail-open). " +
            "This typically happens when using app.handle() directly. Pass trustProxy or " +
            "a custom keyExtractor to silence this warning.",
          "RateLimit",
        );
      }
      return undefined;
    }

    const decision = await policy.store.consume(key, policy);

    if (!decision.allowed) {
      const retryAfter = Math.max(0, Math.ceil((decision.resetMs - Date.now()) / 1000));
      const headers: Record<string, string> = {
        "content-type": "application/problem+json",
        "retry-after": String(retryAfter),
      };
      if (policy.headers) {
        headers["ratelimit-limit"] = String(decision.limit);
        headers["ratelimit-remaining"] = "0";
        headers["ratelimit-reset"] = String(Math.ceil(decision.resetMs / 1000));
      }
      // Canonical RFC 7807 body (github docs/errors type URL, requestId,
      // instance) via the shared mapper. We still return a raw Response —
      // onRequest short-circuits bypass onAfterHandle, so ctx.set mutations
      // made by mapException are irrelevant here.
      const body = this.problemMapper.mapException(
        ctx,
        new TooManyRequestsException("Rate limit exceeded"),
      );
      return new Response(JSON.stringify(body), { status: 429, headers });
    }

    // Allowed: stash decision for success-path header injection.
    if (policy.headers) {
      store.rateLimitDecision = decision;
    }
    return undefined;
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
        if (route.schema.headers) elysiaOptions.headers = route.schema.headers;
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

    const resolvedOrigin = allowedOrigin ?? "*";
    const cache = cors.dynamicHeadersCache;
    if (!cache) {
      return {
        "access-control-allow-origin": resolvedOrigin,
        ...cors.staticHeaders,
      };
    }

    const cached = cache.get(resolvedOrigin);
    if (cached) {
      if (cors.dynamicHeadersMaxEntries === 64) {
        cache.delete(resolvedOrigin);
        cache.set(resolvedOrigin, cached);
      }
      return cached;
    }

    const headers = {
      "access-control-allow-origin": resolvedOrigin,
      ...cors.staticHeaders,
    };
    cache.set(resolvedOrigin, headers);
    if (cors.dynamicHeadersMaxEntries > 0 && cache.size > cors.dynamicHeadersMaxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return headers;
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

    const allowedOrigins = Array.isArray(options.origin) ? new Set(options.origin) : undefined;
    const dynamicHeadersMaxEntries = allowedOrigins
      ? Math.max(allowedOrigins.size, 1)
      : options.origin === true || options.origin === undefined
        ? 64
        : 0;

    return {
      origin: options.origin,
      allowedOrigins,
      fallbackOrigin: Array.isArray(options.origin) ? options.origin[0] : undefined,
      staticHeaders,
      staticCorsHeaders,
      dynamicHeadersCache: staticCorsHeaders
        ? undefined
        : new Map<string, Record<string, string>>(),
      dynamicHeadersMaxEntries,
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
