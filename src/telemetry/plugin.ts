import { definePlugin } from "../core/plugins/define-plugin";
import { resolveTelemetryOptions, type TelemetryOptions } from "./options";
import { installRequestSpanHooks } from "./request-span";
import { startTelemetry } from "./sdk";
import { ProxyTracer } from "./proxy-tracer";
import { METER, TELEMETRY_OPTIONS, TRACER, TRACER_PROVIDER } from "./tokens";
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

      if (resolved.instrumentRequests) {
        installRequestSpanHooks(ctx.http(), holder);
      }

      ctx.onReady(async () => {
        const runtime = await startTelemetry(resolved, () => ctx.app.getInflightCount());
        holder.runtime = runtime;
        proxyTracer.setDelegate(runtime.tracer);
        ctx.provide(TRACER_PROVIDER, runtime.provider);
        if (runtime.meter) ctx.provide(METER, runtime.meter);
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
