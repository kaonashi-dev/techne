import { definePlugin } from "../../../../src/core/index.ts";

interface MetricsOptions {
  prefix?: string;
}

/**
 * A first-class Techne plugin. It registers a DI token, exposes a raw Elysia
 * route at `/metrics`, and hooks the ready/shutdown lifecycle. The `/metrics`
 * route is registered directly on the Elysia instance, so it is not subject to
 * the global prefix, guards, or versioning.
 */
export const MetricsPlugin = definePlugin<MetricsOptions>({
  name: "metrics",
  version: "0.1.0",
  setup(ctx, options) {
    const prefix = options?.prefix ?? "techne_demo_";
    const startedAt = Date.now();

    ctx.provide("METRICS_PREFIX", prefix);
    ctx.logger.log(`metrics registered with prefix "${prefix}"`);

    ctx.http().get("/metrics", () => {
      const uptime = (Date.now() - startedAt) / 1000;
      const mem = process.memoryUsage();
      return (
        `# HELP ${prefix}uptime_seconds Process uptime in seconds.\n` +
        `# TYPE ${prefix}uptime_seconds gauge\n` +
        `${prefix}uptime_seconds ${uptime.toFixed(3)}\n` +
        `# HELP ${prefix}heap_used_bytes Resident heap in bytes.\n` +
        `# TYPE ${prefix}heap_used_bytes gauge\n` +
        `${prefix}heap_used_bytes ${mem.heapUsed}\n`
      );
    });

    ctx.onReady(async () => {
      ctx.logger.log("ready: /metrics endpoint is live");
    });

    ctx.onShutdown(async () => {
      ctx.logger.log("flushing metrics before exit");
    });
  },
});
