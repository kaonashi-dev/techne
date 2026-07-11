/**
 * User-facing telemetry options and the resolver that folds env vars in.
 *
 * The resolver is the single "enabled" gate: it returns `null` when telemetry
 * should be off so the plugin can register nothing and pay zero overhead. No
 * `@opentelemetry/*` import happens here — this stays loadable even when the
 * SDK isn't installed.
 */

export interface TelemetryExporterOptions {
  /** OTLP/HTTP traces endpoint. Defaults to `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`. */
  url?: string;
  /** OTLP/HTTP metrics endpoint. Defaults to `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`. */
  metricsUrl?: string;
  /** Extra OTLP headers (merged over `OTEL_EXPORTER_OTLP_HEADERS`). */
  headers?: Record<string, string>;
}

export interface TelemetrySamplerOptions {
  /** Head-sampling ratio in [0,1], wrapped in a parent-based sampler. */
  ratio?: number;
  /** Explicit sampler kind. Ignored when `ratio` is set. */
  kind?: "always_on" | "always_off" | "parent_based";
}

export interface TelemetryOptions {
  /**
   * Force telemetry on/off. When omitted, telemetry turns on if an OTLP
   * endpoint is configured (option or env) or a test exporter is injected.
   * `OTEL_SDK_DISABLED=true` always wins as an off switch.
   */
  enabled?: boolean;
  /** `service.name` resource attribute. Defaults to `OTEL_SERVICE_NAME` or `"techne-service"`. */
  serviceName?: string;
  /** `service.version` resource attribute. Defaults to `OTEL_SERVICE_VERSION`. */
  serviceVersion?: string;
  /** Additional resource attributes merged onto the resource. */
  resourceAttributes?: Record<string, string | number | boolean>;
  exporter?: TelemetryExporterOptions;
  sampler?: TelemetrySamplerOptions;
  /** Create a per-request server span. Default `true`. */
  instrumentRequests?: boolean;
  /** Export default HTTP metrics. Default `true`. */
  metrics?: boolean;
  /** Periodic metric export interval. Default `10000`ms. */
  metricExportIntervalMillis?: number;
  /**
   * @internal Test seam — inject a `SpanExporter` (e.g. `InMemorySpanExporter`).
   * When present it is wrapped in a `SimpleSpanProcessor` for synchronous export
   * and telemetry is considered enabled.
   */
  spanExporter?: unknown;
  /** @internal Test seam — inject a `PushMetricExporter` (e.g. `InMemoryMetricExporter`). */
  metricExporter?: unknown;
}

export interface ResolvedTelemetryOptions {
  serviceName: string;
  serviceVersion?: string;
  resourceAttributes: Record<string, string | number | boolean>;
  exporter: { url?: string; metricsUrl?: string; headers?: Record<string, string> };
  sampler?: ResolvedTelemetrySamplerOptions;
  instrumentRequests: boolean;
  metrics: boolean;
  metricExportIntervalMillis: number;
  spanExporter?: unknown;
  metricExporter?: unknown;
}

export type ResolvedTelemetrySamplerOptions =
  | { kind: "always_on" }
  | { kind: "always_off" }
  | { kind: "trace_id_ratio"; ratio: number }
  | { kind: "parent_based"; root: "always_on" | "always_off" | { ratio: number } };

function env(name: string): string | undefined {
  const value = typeof Bun !== "undefined" ? Bun.env?.[name] : process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Parse the `key1=value1,key2=value2` form used by `OTEL_EXPORTER_OTLP_HEADERS`. */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Map `OTEL_TRACES_SAMPLER`/`OTEL_TRACES_SAMPLER_ARG` to our sampler shape. */
function resolveEnvSampler(warn: WarnFn): ResolvedTelemetrySamplerOptions | undefined {
  const kind = env("OTEL_TRACES_SAMPLER")?.toLowerCase();
  const arg = env("OTEL_TRACES_SAMPLER_ARG");
  if (!kind) return undefined;
  switch (kind) {
    case "always_on":
      return { kind: "always_on" };
    case "parentbased_always_on":
      return { kind: "parent_based", root: "always_on" };
    case "always_off":
      return { kind: "always_off" };
    case "parentbased_always_off":
      return { kind: "parent_based", root: "always_off" };
    case "traceidratio": {
      return { kind: "trace_id_ratio", ratio: parseRatioOrDefault(arg, warn) };
    }
    case "parentbased_traceidratio": {
      return { kind: "parent_based", root: { ratio: parseRatioOrDefault(arg, warn) } };
    }
    default:
      warn(`Unknown OTEL_TRACES_SAMPLER "${kind}" — using the SDK default sampler.`);
      return undefined;
  }
}

function parseRatioOrDefault(raw: string | undefined, warn: WarnFn): number {
  if (raw === undefined) return 1;
  const ratio = Number(raw);
  if (Number.isFinite(ratio) && ratio >= 0 && ratio <= 1) return ratio;
  warn(`Invalid OTEL_TRACES_SAMPLER_ARG "${raw}" — using the default ratio 1.`);
  return 1;
}

function resolveUserSampler(
  sampler: TelemetrySamplerOptions | undefined,
  warn: WarnFn,
): ResolvedTelemetrySamplerOptions | undefined {
  if (!sampler) return undefined;
  if (sampler.ratio !== undefined) {
    if (!Number.isFinite(sampler.ratio) || sampler.ratio < 0 || sampler.ratio > 1) {
      throw new RangeError("Telemetry sampler ratio must be a finite number in [0,1].");
    }
    return { kind: "parent_based", root: { ratio: sampler.ratio } };
  }
  switch (sampler.kind) {
    case "always_on":
      return { kind: "always_on" };
    case "always_off":
      return { kind: "always_off" };
    case "parent_based":
      return { kind: "parent_based", root: "always_on" };
    default:
      if (sampler.kind !== undefined) {
        warn(`Unknown telemetry sampler kind "${sampler.kind}" — using the SDK default sampler.`);
      }
      return undefined;
  }
}

function appendSignalPath(base: string | undefined, path: string): string | undefined {
  if (!base) return undefined;
  return `${base.endsWith("/") ? base : `${base}/`}${path}`;
}

type WarnFn = (message: string) => void;

/**
 * Resolve user options + env into a concrete config, or `null` when telemetry
 * is disabled. Explicit options always win over env vars. Invalid sampler
 * values fall back to spec defaults and are reported through `warn`.
 */
export function resolveTelemetryOptions(
  options: TelemetryOptions,
  warn: WarnFn = () => {},
): ResolvedTelemetryOptions | null {
  if (options.enabled === false) return null;
  if (env("OTEL_SDK_DISABLED")?.toLowerCase() === "true") return null;

  const genericEndpoint = env("OTEL_EXPORTER_OTLP_ENDPOINT");

  const tracesEndpoint =
    options.exporter?.url ??
    env("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") ??
    appendSignalPath(genericEndpoint, "v1/traces");
  const hasTestExporter = options.spanExporter !== undefined;
  const enabled = options.enabled === true || tracesEndpoint !== undefined || hasTestExporter;
  if (!enabled) return null;

  const metricsEndpoint =
    options.exporter?.metricsUrl ??
    env("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT") ??
    appendSignalPath(genericEndpoint, "v1/metrics");

  return {
    serviceName: options.serviceName ?? env("OTEL_SERVICE_NAME") ?? "techne-service",
    serviceVersion: options.serviceVersion ?? env("OTEL_SERVICE_VERSION"),
    resourceAttributes: options.resourceAttributes ?? {},
    exporter: {
      url: tracesEndpoint,
      metricsUrl: metricsEndpoint,
      headers: {
        ...parseOtlpHeaders(env("OTEL_EXPORTER_OTLP_HEADERS")),
        ...options.exporter?.headers,
      },
    },
    sampler: resolveUserSampler(options.sampler, warn) ?? resolveEnvSampler(warn),
    instrumentRequests: options.instrumentRequests !== false,
    metrics: options.metrics !== false,
    metricExportIntervalMillis: options.metricExportIntervalMillis ?? 10_000,
    spanExporter: options.spanExporter,
    metricExporter: options.metricExporter,
  };
}
