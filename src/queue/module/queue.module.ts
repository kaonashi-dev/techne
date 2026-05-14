import { definePlugin } from "../../core/plugins/define-plugin";
import { createQueueDriver } from "../driver";
import { Queue } from "../queue";
import { QUEUE_DRIVER, QUEUE_MODULE_OPTIONS, getQueueToken } from "../tokens";
import type { QueueModuleOptions, RegisterQueueOptions } from "../types";

export interface QueuePluginOptions extends QueueModuleOptions {
  queues?: RegisterQueueOptions[];
}

/**
 * Plugin-style queue registration. Use with
 * `TechneFactory.create({ plugins: [queue({ queues: [{ name: "emails" }] })] })`.
 */
export function queue(options: QueuePluginOptions = {}) {
  const { queues = [], ...moduleOptions } = options;

  return definePlugin({
    name: "queue",
    setup(ctx) {
      const driver = createQueueDriver(moduleOptions.connection);
      ctx.provide(QUEUE_MODULE_OPTIONS, moduleOptions);
      ctx.provide(QUEUE_DRIVER, driver);
      for (const queueOptions of queues) {
        ctx.provide(
          getQueueToken(queueOptions.name),
          new Queue(queueOptions.name, { ...moduleOptions, ...queueOptions }, driver),
        );
      }
    },
  });
}
