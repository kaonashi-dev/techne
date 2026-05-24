import { Queue } from "./queue";
import { getMqToken } from "./tokens";
import type { JobsOptions } from "./types";

/**
 * Resolver the dispatch layer uses to fetch a `Queue` by name. Set once
 * by the `mq()` plugin during `bootstrap()` so static `Job.dispatch()`
 * and `def.dispatchers.x()` have something to enqueue against.
 *
 * Storing a single function pointer keeps per-dispatch overhead at one
 * indirect call — no DI walk, no Map lookup.
 */
export type QueueResolver = (queueName: string) => Queue;

let activeResolver: QueueResolver | undefined;

/**
 * Install the queue resolver used by every static dispatch path. Called
 * once during `mq()` plugin setup. Subsequent calls replace the resolver
 * (useful for tests).
 */
export function setDispatcherContext(resolver: QueueResolver): void {
  activeResolver = resolver;
}

/** Read the active resolver. Throws if dispatch is called before bootstrap. */
export function getDispatcherContext(): QueueResolver {
  if (!activeResolver) {
    throw new Error(
      "No dispatcher context. Register the mq() plugin via bootstrap() before dispatching.",
    );
  }
  return activeResolver;
}

/** Drop the context. Mostly for test cleanup. */
export function clearDispatcherContext(): void {
  activeResolver = undefined;
}

/**
 * Run `fn` with `resolver` temporarily installed as the dispatcher
 * context, restoring the previous resolver on exit. Use this in tests
 * to dispatch against an isolated container without leaking state.
 */
export async function withDispatcherContext<T>(
  resolver: QueueResolver,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = activeResolver;
  activeResolver = resolver;
  try {
    return await fn();
  } finally {
    activeResolver = previous;
  }
}

/**
 * Core enqueue used by every dispatch path (static `Job.dispatch`,
 * `def.dispatchers.x()`, the standalone `dispatch()` helper). Resolves
 * the queue via the active context and forwards to `queue.add()`.
 */
export async function dispatchToQueue<T>(
  queueName: string,
  jobName: string,
  payload: T,
  options: JobsOptions = {},
): Promise<unknown> {
  const resolver = getDispatcherContext();
  const queue = resolver(queueName);
  return queue.add(jobName, payload, options);
}

/** Helper that the mq plugin uses to wire its container-based resolver. */
export function createResolverFromContainer(
  resolve: (token: unknown) => unknown,
): QueueResolver {
  return (queueName: string) => {
    const queue = resolve(getMqToken(queueName)) as Queue | undefined;
    if (!queue) {
      throw new Error(
        `Queue '${queueName}' is not registered. Add it to mq({ queues: [...] }) in the plugin setup.`,
      );
    }
    return queue;
  };
}
