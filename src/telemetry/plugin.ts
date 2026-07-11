import { definePlugin } from "../core/plugins/define-plugin";
import { resolveTelemetryOptions, type TelemetryOptions } from "./options";
import { installRequestSpanHooks } from "./request-span";
import { startTelemetry } from "./sdk";
import { ProxyTracer } from "./proxy-tracer";
import { METER, METER_PROVIDER, TELEMETRY_OPTIONS, TRACER, TRACER_PROVIDER } from "./tokens";
import type { RuntimeHolder } from "./types";

/**
 * OpenTelemetry plugin. Enable with:
 *
 * ```ts
 * TechneFactory.create({ plugins: [telemetry({ serviceName: "api" })] });
 * ```
 *
 * Runs in the default `before-routes` phase so its terminal hooks apply to
 * every route, but defers the heavy SDK init to `onReady`. When telemetry
 * resolves to disabled, `setup` returns immediately and nothing is registered —
 * zero request-path and cold-start overhead.
 */
export function telemetry(options: TelemetryOptions = {}) {
  return definePlugin({
    name: "telemetry",
    setup(ctx) {
      const resolved = resolveTelemetryOptions(options);
      if (!resolved) return;

      const holder: RuntimeHolder = {};
      const proxyTracer = new ProxyTracer();
      ctx.provide(TELEMETRY_OPTIONS, resolved);
      ctx.provide(TRACER, proxyTracer);
      ctx.app.addRequestHandleBoundary((next) => {
        const runtime = holder.runtime;
        return runtime ? runtime.api.context.with(runtime.api.ROOT_CONTEXT, next) : next();
      });

      if (resolved.instrumentRequests || resolved.metrics) {
        installRequestSpanHooks(ctx.http(), holder, {
          traces: resolved.instrumentRequests,
          metrics: resolved.metrics,
        });
      }

      ctx.onReady(async () => {
        const runtime = await startTelemetry(resolved);
        holder.runtime = runtime;
        proxyTracer.setDelegate(runtime.tracer);
        ctx.provide(TRACER_PROVIDER, runtime.provider);
        if (runtime.meter) ctx.provide(METER, runtime.meter);
        if (runtime.meterProvider) ctx.provide(METER_PROVIDER, runtime.meterProvider);
        ctx.logger.log(
          `OpenTelemetry started — service="${resolved.serviceName}" ` +
            `(${resolved.metrics ? "traces+metrics" : "traces"})`,
        );
      });

      ctx.onShutdown(async () => {
        await holder.runtime?.shutdown();
        holder.runtime = undefined;
      });
    },
  });
}
