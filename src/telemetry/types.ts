import type { Context, Meter, Tracer } from "@opentelemetry/api";

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
  /** Our ALS-backed context manager, used to make the server span active. */
  contextManager: { enterWith(context: Context): void };
  /** Records the default HTTP metrics. Absent when `metrics` is disabled. */
  recordMetrics?: (durationSec: number, attributes: Record<string, string | number>) => void;
  /** Flush + shut down all providers and reset global OTel registrations. */
  shutdown: () => Promise<void>;
}

/** Mutable, per-plugin-instance holder for the started runtime. */
export interface RuntimeHolder {
  runtime?: TelemetryRuntime;
}
