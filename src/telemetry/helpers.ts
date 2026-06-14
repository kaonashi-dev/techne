import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import type { OtelApi } from "./types";

/**
 * DX helpers mirroring `@elysiajs/opentelemetry`'s ergonomics, but reading
 * Techne's own active context. They are safe to import even when telemetry is
 * off or the OTel SDK isn't installed: nothing here statically requires
 * `@opentelemetry/*` (the `import type` is erased), and the runtime refs below
 * are only populated once the plugin starts. When unset, the helpers no-op so
 * instrumented user code keeps working with telemetry disabled.
 */

let api: OtelApi | undefined;
let activeTracer: Tracer | undefined;

/** @internal Wired up by the telemetry SDK in `onReady`. */
export function __setTelemetryRuntime(otelApi: OtelApi, tracer: Tracer): void {
  api = otelApi;
  activeTracer = tracer;
}

/** @internal Cleared on shutdown so a later app can re-init cleanly. */
export function __clearTelemetryRuntime(): void {
  api = undefined;
  activeTracer = undefined;
}

/** The currently active span, or `undefined` when none / telemetry off. */
export function getCurrentSpan(): Span | undefined {
  return api?.trace.getActiveSpan();
}

/** Set attributes on the active span. No-op when there is no active span. */
export function setAttributes(attributes: Attributes): void {
  api?.trace.getActiveSpan()?.setAttributes(attributes);
}

/** The active tracer, or `undefined` when telemetry is off. */
export function getTracer(): Tracer | undefined {
  return activeTracer;
}

/**
 * Run `fn` inside a new active child span named `name`, nested under whatever
 * span is currently active (e.g. the per-request server span). The span is
 * auto-ended and exceptions are recorded — like OTel's `startActiveSpan` but
 * with the bookkeeping handled. When telemetry is off, `fn` runs directly with
 * no span and no overhead.
 */
export function record<T>(name: string, fn: (span?: Span) => T, attributes?: Attributes): T {
  const a = api;
  const tracer = activeTracer;
  if (!a || !tracer) return fn(undefined);

  return tracer.startActiveSpan(name, attributes ? { attributes } : {}, (span: Span): T => {
    try {
      const out = fn(span);
      if (out !== null && typeof (out as { then?: unknown })?.then === "function") {
        return (out as unknown as Promise<unknown>).then(
          (value) => {
            span.setStatus({ code: a.SpanStatusCode.OK });
            span.end();
            return value;
          },
          (err) => {
            failSpan(a, span, err);
            span.end();
            throw err;
          },
        ) as unknown as T;
      }
      span.setStatus({ code: a.SpanStatusCode.OK });
      span.end();
      return out;
    } catch (err) {
      failSpan(a, span, err);
      span.end();
      throw err;
    }
  });
}

function failSpan(a: OtelApi, span: Span, err: unknown): void {
  if (err instanceof Error) span.recordException(err);
  span.setStatus({
    code: a.SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
}
