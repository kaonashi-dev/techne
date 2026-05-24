import type { Queue } from "./queue";
import { getMqToken } from "./tokens";

/**
 * Runtime view over the registered queues, keyed by queue name. Returned
 * to consumers via `@InjectQueue([defA, defB, …])` and typed at the
 * inject site as `QueueBagOf<[typeof defA, typeof defB, …]>`.
 *
 * It is a Proxy-backed lookup so newly-registered queues are visible
 * immediately and unknown names fail loudly instead of returning
 * `undefined`.
 */
export interface QueueBag {
  readonly [queueName: string]: Queue;
}

export function createQueueBag(resolve: (token: unknown) => unknown): QueueBag {
  const cache = new Map<string, Queue>();
  return new Proxy(Object.create(null) as QueueBag, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const cached = cache.get(prop);
      if (cached) return cached;
      let queue: Queue | undefined;
      try {
        queue = resolve(getMqToken(prop)) as Queue | undefined;
      } catch {
        queue = undefined;
      }
      if (!queue) {
        throw new Error(
          `Queue '${prop}' is not registered. Add it to mq({ queues: [...] }) in the plugin setup.`,
        );
      }
      cache.set(prop, queue);
      return queue;
    },
    has(_target, prop) {
      return typeof prop === "string";
    },
  });
}
