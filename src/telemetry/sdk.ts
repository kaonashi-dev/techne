import type { ResolvedTelemetryOptions } from "./options";
import type { TelemetryRuntime } from "./types";
import { setMappedExceptionObserver } from "../core/router/router-response-controller";
import { AlsContextManager } from "./context-manager";
import { __clearTelemetryRuntime, __setTelemetryRuntime } from "./helpers";
import { buildMetrics } from "./metrics";

/**
 * Boot the OpenTelemetry SDK and return a {@link TelemetryRuntime}.
 *
 * Every `@opentelemetry/*` import here is dynamic so the SDK only loads when
 * telemetry is actually enabled — the fast path and cold start pay nothing when
 * it's off. Called from the plugin's `onReady`, after routes have compiled and
 * before traffic.
 */
export async function startTelemetry(
  resolved: ResolvedTelemetryOptions,
  getInflight: () => number,
): Promise<TelemetryRuntime & { provider: unknown }> {
  const api = await import("@opentelemetry/api");
  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const traceBase = await import("@opentelemetry/sdk-trace-base");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const semconv = await import("@opentelemetry/semantic-conventions");

  const resource = resourceFromAttributes({
    [semconv.ATTR_SERVICE_NAME]: resolved.serviceName,
    ...(resolved.serviceVersion ? { [semconv.ATTR_SERVICE_VERSION]: resolved.serviceVersion } : {}),
    ...resolved.resourceAttributes,
  });

  const sampler = buildSampler(traceBase, resolved);

  let spanProcessor;
  if (resolved.spanExporter) {
    // Synchronous export so injected in-memory exporters see spans on `end()`.
    spanProcessor = new traceBase.SimpleSpanProcessor(resolved.spanExporter as never);
  } else {
    const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
    spanProcessor = new traceBase.BatchSpanProcessor(
      new OTLPTraceExporter({ url: resolved.exporter.url, headers: resolved.exporter.headers }),
    );
  }

  const provider = new NodeTracerProvider({ resource, sampler, spanProcessors: [spanProcessor] });
  const contextManager = new AlsContextManager(api.ROOT_CONTEXT);
  // Registers as the global tracer provider + context manager so `record()`,
  // `getActiveSpan()`, and W3C propagation all resolve to this SDK.
  provider.register({ contextManager });
  const tracer = provider.getTracer("@kaonashi-dev/techne");

  __setTelemetryRuntime(api, tracer);

  // Handler exceptions are caught by the route wrapper and turned into
  // problem+json responses, so they never reach Elysia's `onError`. Record them
  // on the active server span at the framework's single exception choke point.
  setMappedExceptionObserver((error) => {
    const span = api.trace.getActiveSpan();
    if (span && error instanceof Error) span.recordException(error);
  });

  const metricsHandle = resolved.metrics
    ? await buildMetrics(resolved, resource, getInflight)
    : undefined;
  if (metricsHandle) {
    api.metrics.setGlobalMeterProvider(metricsHandle.meterProvider as never);
  }

  return {
    api,
    tracer,
    provider,
    meter: metricsHandle?.meter,
    contextManager,
    recordMetrics: metricsHandle?.record,
    shutdown: async () => {
      try {
        await provider.forceFlush();
      } catch {
        // best effort — exporter may be unreachable
      }
      try {
        await provider.shutdown();
      } catch {
        // already shut down
      }
      if (metricsHandle) await metricsHandle.shutdown();
      setMappedExceptionObserver(undefined);
      __clearTelemetryRuntime();
      // Reset global registrations so a later app in the same process can
      // register its own provider/context manager without a "already
      // registered" warning (notably between tests).
      api.trace.disable();
      api.context.disable();
      api.propagation.disable();
      api.metrics.disable();
    },
  };
}

function buildSampler(
  traceBase: typeof import("@opentelemetry/sdk-trace-base"),
  resolved: ResolvedTelemetryOptions,
) {
  const sampler = resolved.sampler;
  if (!sampler) return undefined;
  if (sampler.kind === "always_off") return new traceBase.AlwaysOffSampler();
  if (sampler.kind === "always_on") return new traceBase.AlwaysOnSampler();
  if (typeof sampler.ratio === "number") {
    return new traceBase.ParentBasedSampler({
      root: new traceBase.TraceIdRatioBasedSampler(sampler.ratio),
    });
  }
  return new traceBase.ParentBasedSampler({ root: new traceBase.AlwaysOnSampler() });
}
