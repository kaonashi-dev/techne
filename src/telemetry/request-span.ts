import { parseTraceparent } from "../platform/elysia-adapter";
import { requestContext } from "../services/logger.service";
import type { RuntimeHolder, TelemetryRuntime } from "./types";

/**
 * Per-request server-span hooks, chained AFTER the framework's fused hooks via
 * the raw Elysia instance. Installed at `before-routes` time so the terminal
 * hooks (`onError`, `onAfterResponse`) apply to every route.
 *
 * Lifecycle mapping:
 *  - `onRequest`        → start the span, make it active, bridge to the log ALS.
 *  - `onAfterHandle`    → end + status on the success path (synchronous).
 *  - `onError`          → record the exception + status (thrown errors, 404s).
 *  - `onAfterResponse`  → deferred fallback: ends validation-error spans, where
 *                         the framework's `onError` short-circuits ours and no
 *                         `onAfterHandle` runs.
 * The span is ended exactly once, guarded by a per-request flag, and stashed on
 * the request `ctx` (not the ALS) so the deferred `onAfterResponse` can always
 * retrieve it.
 */

// Stable OTel HTTP semantic-convention attribute keys (mirror
// `@opentelemetry/semantic-conventions` ATTR_* — hardcoded to keep the hooks
// free of a runtime semconv import).
const ATTR_METHOD = "http.request.method";
const ATTR_ROUTE = "http.route";
const ATTR_URL_PATH = "url.path";
const ATTR_URL_SCHEME = "url.scheme";
const ATTR_SERVER_ADDRESS = "server.address";
const ATTR_USER_AGENT = "user_agent.original";
const ATTR_STATUS = "http.response.status_code";

const OTEL_SPAN = Symbol("techne.otel.span");
const OTEL_START = Symbol("techne.otel.start");
const OTEL_ENDED = Symbol("techne.otel.ended");

export function installRequestSpanHooks(elysia: any, holder: RuntimeHolder): void {
  elysia.onRequest((ctx: any) => {
    const rt = holder.runtime;
    if (!rt) return;

    const req = ctx.request;
    const { traceId, spanId } = parseTraceparent(req.headers.get("traceparent"));
    const root = rt.api.ROOT_CONTEXT;
    const parentCtx =
      traceId && spanId
        ? rt.api.trace.setSpanContext(root, {
            traceId,
            spanId,
            traceFlags: rt.api.TraceFlags.SAMPLED,
            isRemote: true,
          })
        : root;

    const url = safeUrl(req.url);
    const method = req.method;
    // The matched route pattern (`ctx.route`) isn't available in onRequest —
    // routing runs after this hook. Name the span provisionally from the path;
    // the terminal hooks upgrade the name + set `http.route` once it's known.
    const provisionalPath = url?.pathname || "/";

    const attributes: Record<string, string | number> = {
      [ATTR_METHOD]: method,
    };
    if (url) {
      attributes[ATTR_URL_PATH] = url.pathname;
      attributes[ATTR_URL_SCHEME] = url.protocol.replace(":", "");
      if (url.host) attributes[ATTR_SERVER_ADDRESS] = url.host;
    }
    const userAgent = req.headers.get("user-agent");
    if (userAgent) attributes[ATTR_USER_AGENT] = userAgent;

    const span = rt.tracer.startSpan(
      `${method} ${provisionalPath}`,
      { kind: rt.api.SpanKind.SERVER, attributes },
      parentCtx,
    );

    ctx[OTEL_SPAN] = span;
    ctx[OTEL_START] = Bun.nanoseconds();

    // Make the server span active for the rest of the request so `record()`
    // and `getCurrentSpan()` in user code nest under it.
    rt.contextManager.enterWith(rt.api.trace.setSpan(parentCtx, span));

    // Bridge: surface the EMITTED span id to the logger ALS so logs and spans
    // share one correlation id. Mutates the existing store in place (the same
    // idiom the adapter uses to sync requestId).
    const rc = requestContext.getStore();
    if (rc) {
      const sc = span.spanContext();
      rc.traceId = sc.traceId;
      rc.spanId = sc.spanId;
    }
    return undefined;
  });

  elysia.onAfterHandle((ctx: any) => {
    const rt = holder.runtime;
    if (!rt) return;
    const span = ctx[OTEL_SPAN];
    if (!span || ctx[OTEL_ENDED]) return;

    const status = typeof ctx.set?.status === "number" ? ctx.set.status : 200;
    span.setStatus({
      code: status >= 500 ? rt.api.SpanStatusCode.ERROR : rt.api.SpanStatusCode.OK,
    });
    endSpan(rt, ctx, span, status);
    return undefined;
  });

  elysia.onError((ctx: any) => {
    const rt = holder.runtime;
    if (!rt) return;
    const span = ctx[OTEL_SPAN];
    if (!span || ctx[OTEL_ENDED]) return;

    const status = errorStatus(ctx);
    const err = ctx.error;
    // Only treat 5xx as span errors; 4xx (404, validation) are not server
    // faults. Handler-thrown exceptions are recorded separately via the
    // mapException observer, since they never reach this hook.
    if (status >= 500) {
      if (err instanceof Error) span.recordException(err);
      span.setStatus({
        code: rt.api.SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : undefined,
      });
    } else {
      span.setStatus({ code: rt.api.SpanStatusCode.OK });
    }
    endSpan(rt, ctx, span, status);
    return undefined;
  });

  elysia.onAfterResponse((ctx: any) => {
    const rt = holder.runtime;
    if (!rt) return;
    const span = ctx[OTEL_SPAN];
    if (!span || ctx[OTEL_ENDED]) return;

    const status = typeof ctx.set?.status === "number" ? ctx.set.status : 200;
    span.setStatus({
      code: status >= 500 ? rt.api.SpanStatusCode.ERROR : rt.api.SpanStatusCode.OK,
    });
    endSpan(rt, ctx, span, status);
    return undefined;
  });
}

function endSpan(rt: TelemetryRuntime, ctx: any, span: any, status: number): void {
  ctx[OTEL_ENDED] = true;
  // `ctx.route` (the low-cardinality matched pattern) is known by the terminal
  // phase — upgrade the provisional name and set http.route. Absent on a 404.
  const route = typeof ctx.route === "string" && ctx.route ? ctx.route : undefined;
  if (route) {
    span.updateName(`${ctx.request?.method ?? "HTTP"} ${route}`);
    span.setAttribute(ATTR_ROUTE, route);
  }
  span.setAttribute(ATTR_STATUS, status);
  span.end();
  if (rt.recordMetrics) {
    const start = ctx[OTEL_START];
    const durationSec = typeof start === "number" ? (Bun.nanoseconds() - start) / 1e9 : 0;
    rt.recordMetrics(durationSec, {
      [ATTR_METHOD]: ctx.request?.method ?? "",
      [ATTR_ROUTE]: route ?? "",
      [ATTR_STATUS]: status,
    });
  }
}

/** Best-effort HTTP status for an error, mirroring `RouterResponseController.mapException`. */
function errorStatus(ctx: any): number {
  const err = ctx.error;
  if (err && typeof err.getStatus === "function") {
    try {
      const s = err.getStatus();
      if (typeof s === "number") return s;
    } catch {
      // fall through
    }
  }
  if (err && typeof err.status === "number") return err.status;
  if (typeof ctx.set?.status === "number") return ctx.set.status;
  switch (ctx.code) {
    case "NOT_FOUND":
      return 404;
    case "VALIDATION":
      return 422;
    case "PARSE":
      return 400;
    case "INVALID_COOKIE_SIGNATURE":
      return 401;
    default:
      return 500;
  }
}

function safeUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}
