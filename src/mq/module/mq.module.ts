import { definePlugin } from "../../core/plugins/define-plugin";
import { clearChainStore, setChainStore } from "../chain-context";
import { MemoryChainStore } from "../chain-store";
import { clearBatchStore, setBatchStore } from "../batch-context";
import { MemoryBatchStore } from "../batch-store";
import {
  isQueueBagDef,
  isQueueDef,
  QUEUE_BAG_TOKEN,
  type QueueBagDef,
  type QueueDef,
} from "../define-queue";
import {
  clearDispatcherContext,
  createResolverFromContainer,
  setDispatcherContext,
} from "../dispatcher";
import { createMqDriver } from "../driver";
import { Queue } from "../queue";
import { createQueueBag } from "../queue-bag";
import { getMqToken, MQ_DRIVER, MQ_MODULE_OPTIONS, MQ_QUEUE_BAG } from "../tokens";
import type { MqModuleOptions, RegisterQueueOptions } from "../types";

/**
 * A queue entry can be a `QueueDef`, a `QueueBagDef` (the bag's
 * constituent queues are auto-registered), a `RegisterQueueOptions`
 * object, or a bare queue name string.
 */
export type MqQueueRegistration = RegisterQueueOptions | QueueDef | QueueBagDef | string;

export interface MqPluginOptions extends MqModuleOptions {
  queues?: MqQueueRegistration[];
}

function normalizeQueue(entry: MqQueueRegistration): RegisterQueueOptions {
  if (typeof entry === "string") return { name: entry };
  if (isQueueDef(entry)) return { name: entry.name };
  // Bag entries are handled in the setup loop; this path is unreachable.
  return entry as RegisterQueueOptions;
}

/**
 * Plugin-style MQ registration. Use with
 * `TechneFactory.create({ plugins: [mq({ queues: [PayinsQueueDef] })] })`.
 */
export function mq(options: MqPluginOptions = {}) {
  const { queues = [], ...moduleOptions } = options;

  return definePlugin({
    name: "mq",
    setup(ctx) {
      const driver = createMqDriver(moduleOptions.connection);
      ctx.provide(MQ_MODULE_OPTIONS, moduleOptions);
      ctx.provide(MQ_DRIVER, driver);
      ctx.provide(
        MQ_QUEUE_BAG,
        createQueueBag((token) => ctx.resolve(token)),
      );

      const resolver = createResolverFromContainer((token) => ctx.resolve(token));
      setDispatcherContext(resolver);
      setChainStore(new MemoryChainStore());
      setBatchStore(new MemoryBatchStore());
      ctx.onShutdown(() => {
        clearDispatcherContext();
        clearChainStore();
        clearBatchStore();
      });

      const registered = new Set<string>();
      const bags: QueueBagDef[] = [];

      const registerQueue = (opts: RegisterQueueOptions) => {
        if (registered.has(opts.name)) return;
        registered.add(opts.name);
        ctx.provide(
          getMqToken(opts.name),
          new Queue(opts.name, { ...moduleOptions, ...opts }, driver),
        );
      };

      for (const entry of queues) {
        if (isQueueBagDef(entry)) {
          bags.push(entry);
          for (const def of entry.defs) registerQueue({ name: def.name });
          continue;
        }
        registerQueue(normalizeQueue(entry));
      }

      // Bind each bag's synthetic token to a frozen user-keyed mapping.
      for (const bag of bags) {
        const view: Record<string, Queue> = {};
        for (const [key, def] of Object.entries(bag.queues)) {
          view[key] = ctx.resolve<Queue>(getMqToken(def.name));
        }
        ctx.provide(bag[QUEUE_BAG_TOKEN], Object.freeze(view));
      }
    },
  });
}
