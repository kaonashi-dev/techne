import type { Context, Meter, MeterProvider, Tracer } from "@opentelemetry/api";

/** The dynamically-imported `@opentelemetry/api` namespace. */
export type OtelApi = typeof import("@opentelemetry/api");

/**
 * Everything the request hooks need once telemetry has actually started.
 * Built in `onReady` (after the heavy dynamic imports) and stashed on a
 * per-plugin {@link RuntimeHolder} so the hooks installed earlier (at
 * `before-routes` time) can read it lazily.
 */
export interface TelemetryRuntime {
  api: OtelApi;
  tracer: Tracer;
  meter?: Meter;
  meterProvider?: MeterProvider;
  /** Our ALS-backed context manager, used to make the server span active. */
  contextManager: { enterWith(context: Context): void };
  /** Increments the active-request metric. Absent when `metrics` is disabled. */
  startMetrics?: (attributes: Record<string, string | number>) => void;
  /** Records completion metrics and decrements the active-request metric. */
  recordMetrics?: (
    durationSec: number,
    attributes: Record<string, string | number>,
    activeAttributes: Record<string, string | number>,
  ) => void;
  /** Flush + shut down all providers and reset global OTel registrations. */
  shutdown: () => Promise<void>;
}

/** Mutable, per-plugin-instance holder for the started runtime. */
export interface RuntimeHolder {
  runtime?: TelemetryRuntime;
}
