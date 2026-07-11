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
  start: (attributes: Record<string, string | number>) => void;
  record: (
    durationSec: number,
    attributes: Record<string, string | number>,
    activeAttributes: Record<string, string | number>,
  ) => void;
  shutdown: () => Promise<void>;
}

/**
 * Build a `MeterProvider` with the default HTTP instruments. Request hooks
 * increment/decrement the active-request UpDownCounter with the required
 * method and scheme attributes, while reusing the request span timer.
 */
export async function buildMetrics(
  resolved: ResolvedTelemetryOptions,
  resource: Resource,
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
    advice: {
      explicitBucketBoundaries: [
        0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
      ],
    },
  });
  const count = meter.createCounter("http.server.request.count", {
    description: "Count of inbound HTTP server requests",
  });
  const activeRequests = meter.createUpDownCounter("http.server.active_requests", {
    description: "Number of in-flight HTTP server requests",
    unit: "{request}",
  });

  return {
    meter,
    meterProvider,
    start: (attributes) => {
      activeRequests.add(1, attributes);
    },
    record: (durationSec, attributes, activeAttributes) => {
      duration.record(durationSec, attributes);
      count.add(1, attributes);
      activeRequests.add(-1, activeAttributes);
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
