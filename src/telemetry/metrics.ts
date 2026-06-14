import type { Meter, MeterProvider } from "@opentelemetry/api";
import type { Resource } from "@opentelemetry/resources";
import type { ResolvedTelemetryOptions } from "./options";

/** Stable OTel HTTP metric attribute keys (mirror `@opentelemetry/semantic-conventions`). */
const ATTR_METHOD = "http.request.method";
const ATTR_ROUTE = "http.route";
const ATTR_STATUS = "http.response.status_code";

export interface MetricsHandle {
  meter: Meter;
  meterProvider: MeterProvider;
  record: (durationSec: number, attributes: Record<string, string | number>) => void;
  shutdown: () => Promise<void>;
}

/**
 * Build a `MeterProvider` with the default HTTP instruments. All data comes
 * from what the framework already tracks — no second timer, and the
 * active-requests gauge observes the adapter's existing inflight counter via
 * `getInflight`.
 */
export async function buildMetrics(
  resolved: ResolvedTelemetryOptions,
  resource: Resource,
  getInflight: () => number,
): Promise<MetricsHandle> {
  const sdkMetrics = await import("@opentelemetry/sdk-metrics");

  let exporter;
  if (resolved.metricExporter) {
    exporter = resolved.metricExporter as ConstructorParameters<
      typeof sdkMetrics.PeriodicExportingMetricReader
    >[0]["exporter"];
  } else {
    const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
    exporter = new OTLPMetricExporter({
      url: resolved.exporter.metricsUrl,
      headers: resolved.exporter.headers,
    });
  }

  const reader = new sdkMetrics.PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: resolved.metricExportIntervalMillis,
  });
  const meterProvider = new sdkMetrics.MeterProvider({ resource, readers: [reader] });
  const meter = meterProvider.getMeter("@kaonashi-dev/techne");

  const duration = meter.createHistogram("http.server.request.duration", {
    description: "Duration of inbound HTTP server requests",
    unit: "s",
  });
  const count = meter.createCounter("http.server.request.count", {
    description: "Count of inbound HTTP server requests",
  });
  const activeRequests = meter.createObservableGauge("http.server.active_requests", {
    description: "Number of in-flight HTTP server requests",
  });
  activeRequests.addCallback((result) => {
    result.observe(getInflight());
  });

  return {
    meter,
    meterProvider,
    record: (durationSec, attributes) => {
      duration.record(durationSec, attributes);
      count.add(1, attributes);
    },
    shutdown: async () => {
      try {
        await meterProvider.forceFlush();
      } catch {
        // best effort — exporter may be unreachable
      }
      try {
        await meterProvider.shutdown();
      } catch {
        // already shut down
      }
    },
  };
}

export const METRIC_ATTRS = { ATTR_METHOD, ATTR_ROUTE, ATTR_STATUS };
