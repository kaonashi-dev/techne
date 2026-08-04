import { StatusMap } from "elysia";
import { requestContext } from "../services/logger.service";
import type { RuntimeHolder, TelemetryRuntime } from "./types";

/**
 * Per-request OpenTelemetry hooks. `mapResponse` is the primary terminal phase:
 * it runs after handlers and error mapping, but before Elysia returns the final
 * Response. `onAfterResponse` is a last-resort fallback for response paths that
 * bypass mapping.
 */

const ATTR_METHOD = "http.request.method";
const ATTR_ROUTE = "http.route";
const ATTR_URL_PATH = "url.path";
const ATTR_URL_SCHEME = "url.scheme";
const ATTR_SERVER_ADDRESS = "server.address";
const ATTR_SERVER_PORT = "server.port";
const ATTR_USER_AGENT = "user_agent.original";
const ATTR_STATUS = "http.response.status_code";
const ATTR_ERROR_TYPE = "error.type";

const OTEL_SPAN = Symbol("techne.otel.span");
const OTEL_START = Symbol("techne.otel.start");
const OTEL_ENDED = Symbol("techne.otel.ended");
const OTEL_ACTIVE_METRIC_ATTRS = Symbol("techne.otel.active-metric-attrs");
const OTEL_END_ACTIVE = Symbol("techne.otel.end-active");

const headersGetter = {
  keys(carrier: Headers): string[] {
    return [...carrier.keys()];
  },
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
};

export function installRequestSpanHooks(
  elysia: any,
  holder: RuntimeHolder,
  enabled: { traces: boolean; metrics: boolean },
): void {
  elysia.request((ctx: any) => {
    const rt = holder.runtime;
    if (!rt) return;

    const req = ctx.request;
    const url = safeUrl(req.url);
    const method = req.method;
    ctx[OTEL_START] = Bun.nanoseconds();

    const activeMetricAttributes: Record<string, string | number> = {
      [ATTR_METHOD]: method,
      [ATTR_URL_SCHEME]: url?.protocol.replace(":", "") ?? "http",
    };
    if (url?.hostname) activeMetricAttributes[ATTR_SERVER_ADDRESS] = url.hostname;
    if (url?.port) activeMetricAttributes[ATTR_SERVER_PORT] = Number(url.port);
    if (enabled.metrics && rt.startMetrics) {
      ctx[OTEL_ACTIVE_METRIC_ATTRS] = activeMetricAttributes;
      ctx[OTEL_END_ACTIVE] = rt.startMetrics(activeMetricAttributes);
    }

    if (!enabled.traces) return undefined;

    const root = rt.api.ROOT_CONTEXT;
    const parentCtx = rt.api.propagation.extract(root, req.headers, headersGetter);
    const attributes: Record<string, string | number> = {
      [ATTR_METHOD]: method,
    };
    if (url) {
      attributes[ATTR_URL_PATH] = url.pathname;
      attributes[ATTR_URL_SCHEME] = url.protocol.replace(":", "");
      if (url.hostname) attributes[ATTR_SERVER_ADDRESS] = url.hostname;
      if (url.port) attributes[ATTR_SERVER_PORT] = Number(url.port);
    }
    const userAgent = req.headers.get("user-agent");
    if (userAgent) attributes[ATTR_USER_AGENT] = userAgent;

    // The route template is unavailable in onRequest. Use the method-only
    // compliant fallback and upgrade the name once routing has completed.
    const span = rt.tracer.startSpan(
      method,
      { kind: rt.api.SpanKind.SERVER, attributes },
      parentCtx,
    );

    ctx[OTEL_SPAN] = span;
    rt.contextManager.enterWith(rt.api.trace.setSpan(parentCtx, span));

    const rc = requestContext.getStore();
    if (rc) {
      const sc = span.spanContext();
      rc.traceId = sc.traceId;
      rc.spanId = sc.spanId;
    }
    return undefined;
  });

  elysia.mapResponse((ctx: any) => {
    finishRequest(holder.runtime, ctx);
  });

  elysia.error((ctx: any) => {
    finishRequest(holder.runtime, ctx);
  });

  elysia.afterResponse((ctx: any) => {
    finishRequest(holder.runtime, ctx);
  });
}

function finishRequest(rt: TelemetryRuntime | undefined, ctx: any): void {
  if (ctx[OTEL_ENDED]) return;
  const span = ctx[OTEL_SPAN];
  const endActiveRequest = ctx[OTEL_END_ACTIVE] as (() => void) | undefined;
  const activeMetricAttributes = ctx[OTEL_ACTIVE_METRIC_ATTRS] as
    | Record<string, string | number>
    | undefined;
  if (!span && !endActiveRequest) return;

  ctx[OTEL_ENDED] = true;
  // Balance the counter even when the runtime is torn down mid-request — an
  // unbalanced UpDownCounter drifts forever. Requests aborted before any
  // terminal hook fires still leak; Elysia exposes no abort hook to catch them.
  endActiveRequest?.();
  if (!rt) return;

  const status = responseStatus(ctx);
  const route = resolveRoute(ctx, status);

  try {
    if (span) {
      if (route) {
        span.updateName(`${ctx.request?.method ?? "HTTP"} ${route}`);
        span.setAttribute(ATTR_ROUTE, route);
      }
      span.setAttribute(ATTR_STATUS, status);
      if (status >= 500) {
        const err = ctx.error;
        if (err instanceof Error) span.recordException(err);
        span.setAttribute(ATTR_ERROR_TYPE, String(status));
        span.setStatus({ code: rt.api.SpanStatusCode.ERROR });
      }
      span.end();
    }

    if (rt.recordMetrics && activeMetricAttributes) {
      const start = ctx[OTEL_START];
      const durationSec = typeof start === "number" ? (Bun.nanoseconds() - start) / 1e9 : 0;
      const attributes: Record<string, string | number> = {
        ...activeMetricAttributes,
        [ATTR_STATUS]: status,
      };
      if (route) attributes[ATTR_ROUTE] = route;
      if (status >= 500) attributes[ATTR_ERROR_TYPE] = String(status);
      rt.recordMetrics(durationSec, attributes);
    }
  } finally {
    // `enterWith` is necessary to bridge Elysia's separate lifecycle callbacks,
    // but must be balanced or caller work inherits an ended request span.
    if (span) rt.contextManager.enterWith(rt.api.ROOT_CONTEXT);
  }
}

/**
 * Resolve the low-cardinality route template for `http.route`.
 *
 * Elysia 2 only populates `ctx.route` for parameterized routes. Static routes
 * leave it `undefined` and carry the literal path in `ctx.path` — which, for a
 * static route, *is* the template, so it is safe to use.
 *
 * The 404 guard is what makes that safe in general. `http.route` must stay
 * low-cardinality because it is a metric dimension; falling back to `ctx.path`
 * on an unmatched request would mint a fresh time series for every URL a
 * scanner probes. When nothing matched there is no template to report, so we
 * report none.
 */
function resolveRoute(ctx: any, status: number): string | undefined {
  const route = ctx.route;
  if (typeof route === "string" && route) return route;
  if (status === 404) return undefined;
  const path = ctx.path;
  return typeof path === "string" && path ? path : undefined;
}

function responseStatus(ctx: any): number {
  const err = ctx.error;
  if (err && typeof err.getStatus === "function") {
    try {
      const status = err.getStatus();
      if (typeof status === "number") return status;
    } catch {
      // fall through
    }
  }
  if (err && typeof err.status === "number") return err.status;
  // Elysia 2 removed the string `ctx.code` discriminator in favour of error
  // classes, and every built-in error class now carries its own numeric
  // `status` — which the check above already consumed. This name-based switch
  // remains only for errors that reach us without one (a user class thrown
  // from a handler that mimics Elysia's naming).
  switch (err?.name) {
    case "NotFound":
      return 404;
    case "ValidationError":
      return 422;
    case "ParseError":
      return 400;
    case "InvalidCookieSignature":
    case "InvalidCookie":
      return 401;
    default:
      break;
  }
  const setStatus = ctx.set?.status;
  if (typeof setStatus === "number") return setStatus;
  // Elysia accepts status keywords (`set.status = "Created"`); resolve them
  // the same way it does when building the final Response.
  if (typeof setStatus === "string" && setStatus in StatusMap) {
    return StatusMap[setStatus as keyof typeof StatusMap];
  }
  if (ctx.response instanceof Response) return ctx.response.status;
  return err ? 500 : 200;
}

function safeUrl(raw: string): URL | undefined {
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}
