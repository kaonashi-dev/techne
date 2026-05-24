import { AsyncLocalStorage } from "node:async_hooks";
import { JobNotUniqueError } from "./errors";
import { Queue } from "./queue";
import { getMqToken } from "./tokens";
import type { PendingDispatch } from "./pending-dispatch";
import type { JobsOptions, QueueDriver } from "./types";

// ── Per-request deferred dispatch buffer ─────────────────────────────────────

/**
 * ALS store that holds the deferred `PendingDispatch` queue for the current
 * HTTP request. Populated by `runWithDeferredBuffer` (wired in the `mq()`
 * plugin's `onRequest` hook) and drained by `flushDeferred` in `onAfterResponse`.
 *
 * When `getStore()` returns `undefined` the caller is outside an HTTP context
 * (e.g. a worker job or CLI) and should fall back to immediate dispatch.
 */
const deferredStore = new AsyncLocalStorage<PendingDispatch[]>();

/**
 * Enter a fresh deferred-dispatch scope and run `fn` inside it. Every call to
 * `pushDeferred` within `fn` (and within async continuations it spawns) will
 * enqueue onto the buffer returned by `getDeferredBuffer()`.
 *
 * Used by the `mq()` plugin to scope one buffer per HTTP request.
 */
export function runWithDeferredBuffer<T>(fn: () => T): T {
  return deferredStore.run([], fn);
}

/**
 * Return the deferred-dispatch buffer for the current async context, or
 * `undefined` when called outside an HTTP request scope.
 */
export function getDeferredBuffer(): PendingDispatch[] | undefined {
  return deferredStore.getStore();
}

/**
 * Enter a fresh deferred-dispatch scope using `enterWith` — sets a new empty
 * buffer on the current async resource so all continuations in this request's
 * promise chain inherit it. Call this from the HTTP adapter's `onRequest` hook.
 *
 * Prefer this over `runWithDeferredBuffer` in Elysia hooks because hooks are
 * sequential continuations of the same promise chain; `enterWith` is sufficient
 * and avoids having to wrap the entire request in a `run()` callback.
 */
export function enterDeferredBuffer(): void {
  deferredStore.enterWith([]);
}

/**
 * Push `pd` onto the current request's deferred buffer. When called outside
 * an HTTP context (no buffer in scope) this is a no-op — callers that want
 * fire-and-forget fallback outside HTTP must handle that themselves.
 */
export function pushDeferred(pd: PendingDispatch): void {
  const buf = deferredStore.getStore();
  if (buf) {
    buf.push(pd);
  }
  // Outside HTTP context: callers handle the fire-and-forget fallback.
}

/**
 * Drain all pending dispatches in the current request's deferred buffer.
 * Errors during individual dispatches are logged and swallowed — we cannot
 * surface them after the response has already been sent.
 *
 * No-op when called outside an HTTP context or when the buffer is empty.
 */
export async function flushDeferred(): Promise<void> {
  const buf = deferredStore.getStore();
  if (!buf || buf.length === 0) return;
  const items = buf.splice(0);
  for (const pd of items) {
    try {
      await pd;
    } catch (e) {
      console.error("[mq] deferred dispatch error", e);
    }
  }
}

// ── Driver context (used for uniqueness lock operations) ──────────────────────

let activeDriver: QueueDriver | undefined;

/** Install the driver used by uniqueness checks. Called once during `mq()` plugin setup. */
export function setDriverContext(driver: QueueDriver): void {
  activeDriver = driver;
}

/** Drop the driver context. For test cleanup. */
export function clearDriverContext(): void {
  activeDriver = undefined;
}

/** Read the active driver. Returns `undefined` when called before `mq()` bootstraps (e.g. dispatchSync). */
export function getDriverContext(): QueueDriver | undefined {
  return activeDriver;
}

/**
 * Options controlling job uniqueness. Mirrors the `UniqueOptions` interface
 * on the decorators — duplicated here so `dispatchToQueue` has no decorator dep.
 */
export interface DispatchUniqueOptions {
  for: number;
  key?: (payload: unknown) => string;
  throwIfLocked?: boolean;
  untilProcessing?: boolean;
}

// ── Queue resolver context ────────────────────────────────────────────────────

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
 *
 * When `uniqueOptions` is provided the driver's uniqueness lock is acquired
 * before enqueuing. If the lock is already held the dispatch is silently
 * dropped (returns `undefined`) unless `throwIfLocked: true` is set.
 */
export async function dispatchToQueue<T>(
  queueName: string,
  jobName: string,
  payload: T,
  options: JobsOptions = {},
  uniqueOptions?: DispatchUniqueOptions,
): Promise<unknown> {
  if (uniqueOptions && activeDriver) {
    const keyStr = uniqueOptions.key ? uniqueOptions.key(payload) : JSON.stringify(payload);
    const lockKey = `${queueName}:${jobName}:${keyStr}`;
    const acquired = await activeDriver.acquireUniqueLock(lockKey, uniqueOptions.for);
    if (!acquired) {
      if (uniqueOptions.throwIfLocked) {
        throw new JobNotUniqueError(lockKey);
      }
      return undefined;
    }
    // Pass the lockKey through the job options so the worker can release it.
    // When `untilProcessing` is true, the worker releases the lock immediately
    // after claiming the job (before `handle()` runs).
    options = {
      ...options,
      lockKey,
      ...(uniqueOptions.untilProcessing ? { lockUntilProcessing: true } : {}),
    };
  }

  const resolver = getDispatcherContext();
  const queue = resolver(queueName);
  return queue.add(jobName, payload, options);
}

/** Helper that the mq plugin uses to wire its container-based resolver. */
export function createResolverFromContainer(resolve: (token: unknown) => unknown): QueueResolver {
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
