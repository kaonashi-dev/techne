import { definePlugin } from "../../core/plugins/define-plugin";
import { createMqDriver } from "../driver";
import { Queue } from "../queue";
import { getMqToken, MQ_DRIVER, MQ_MODULE_OPTIONS } from "../tokens";
import type { MqModuleOptions, RegisterQueueOptions } from "../types";

export interface MqPluginOptions extends MqModuleOptions {
  queues?: RegisterQueueOptions[];
}

/**
 * Plugin-style MQ registration. Use with
 * `TechneFactory.create({ plugins: [mq({ queues: [{ name: "emails" }] })] })`.
 */
export function mq(options: MqPluginOptions = {}) {
  const { queues = [], ...moduleOptions } = options;

  return definePlugin({
    name: "mq",
    setup(ctx) {
      const driver = createMqDriver(moduleOptions.connection);
      ctx.provide(MQ_MODULE_OPTIONS, moduleOptions);
      ctx.provide(MQ_DRIVER, driver);
      for (const queueOptions of queues) {
        ctx.provide(
          getMqToken(queueOptions.name),
          new Queue(queueOptions.name, { ...moduleOptions, ...queueOptions }, driver),
        );
      }
    },
  });
}
