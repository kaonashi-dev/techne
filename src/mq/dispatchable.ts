import {
  MQ_DEFAULT_BACKOFF,
  MQ_DEFAULT_QUEUE,
  MQ_DEFAULT_TIMEOUT,
  MQ_DEFAULT_TRIES,
  MQ_UNIQUE_METADATA,
  MQ_UNIQUE_UNTIL_PROCESSING_METADATA,
} from "../common/constants";
import { getMetadata } from "../core/metadata-store";
import { Injectable } from "../decorators/injectable.decorator";
import type { UniqueOptions } from "./decorators/unique.decorator";
import { getDeferredBuffer, type DispatchUniqueOptions } from "./dispatcher";
import { PendingDispatch } from "./pending-dispatch";
import type { BackoffOptions, JobsOptions } from "./types";
import type { QueueDef } from "./define-queue";
import type { JobMiddleware } from "./types";

/**
 * Marker metadata for `Dispatchable` subclasses. Read by `MqRegistry`
 * during provider scan to auto-register each subclass as a job handler
 * for its `static queue.name + static jobName`.
 */
export const DISPATCHABLE_MARKER = Symbol("DISPATCHABLE_MARKER");

/**
 * Base class for "the class is the job" style. Subclasses declare their
 * payload via the type parameter, point at a `QueueDef` via `static
 * queue`, and implement `handle(payload)`. Dispatching is a single
 * statement: `await MyJob.dispatch(payload).delay(1000)`.
 *
 * The class is registered as a normal DI provider — constructor
 * dependencies are injected when the worker resolves it to run a job.
 *
 * @example
 *   class InitiatePayin extends Dispatchable<{ payinId: string }> {
 *     static queue = PayinsQueueDef;
 *     static jobName = "initiate-payin"; // optional; defaults to class name
 *     constructor(private exec: CoPayinsExecutionService) { super(); }
 *     async handle({ payinId }: { payinId: string }) {
 *       await this.exec.initiatePayin(payinId);
 *     }
 *   }
 *
 *   await InitiatePayin.dispatch({ payinId: "pi_123" })
 *     .delay(60_000).tries(3);
 */
export abstract class Dispatchable<TPayload = void, TResult = unknown> {
  /** Queue this job belongs to. Required on every subclass. */
  static queue: QueueDef;

  /** Job name used at enqueue + handler-lookup. Defaults to the class name. */
  static jobName?: string;

  /** Marker that survives minification; checked by the registry scan. */
  static readonly [DISPATCHABLE_MARKER] = true;

  /** Handler body. Implementers receive the payload that was dispatched. */
  abstract handle(payload: TPayload): Promise<TResult> | TResult;

  /**
   * Return the middleware stack to wrap this job's handler.
   * Left-to-right order — the first middleware is the outermost wrapper.
   */
  middleware?(): JobMiddleware[];

  /**
   * Fluent dispatch. Awaiting the returned `PendingDispatch` enqueues
   * the job via the active dispatcher context (set up by `mq()`).
   */
  static dispatch<C extends DispatchableConstructor<unknown, unknown>>(
    this: C,
    ...args: PayloadArgs<C>
  ): PendingDispatch<PayloadOf<C>, ResultOf<C>> {
    return buildPendingDispatch(this, args[0]);
  }

  /** `dispatch(payload).dispatchSync()` shorthand. */
  static dispatchSync<C extends DispatchableConstructor<unknown, unknown>>(
    this: C,
    ...args: PayloadArgs<C>
  ): Promise<ResultOf<C> | undefined> {
    return buildPendingDispatch(this, args[0]).dispatchSync();
  }

  /** Dispatch only if `condition` is truthy. */
  static dispatchIf<C extends DispatchableConstructor<unknown, unknown>>(
    this: C,
    condition: boolean,
    ...args: PayloadArgs<C>
  ): PendingDispatch<PayloadOf<C>, ResultOf<C>> {
    return buildPendingDispatch(this, args[0]).dispatchIf(condition);
  }

  /** Dispatch only if `condition` is falsy. */
  static dispatchUnless<C extends DispatchableConstructor<unknown, unknown>>(
    this: C,
    condition: boolean,
    ...args: PayloadArgs<C>
  ): PendingDispatch<PayloadOf<C>, ResultOf<C>> {
    return buildPendingDispatch(this, args[0]).dispatchUnless(condition);
  }

  /**
   * Defer enqueue until after the HTTP response has been flushed.
   *
   * Inside an HTTP request (established by the `mq()` plugin's `onRequest`
   * hook), the job is held in the per-request ALS buffer and dispatched in
   * `onAfterResponse` — after the client has already received the response,
   * so this path never blocks the response time.
   *
   * Outside an HTTP context (worker jobs, CLI commands, tests) there is no
   * buffer; the job is dispatched immediately as a fire-and-forget (errors
   * are logged to `console.error` but do not propagate).
   *
   * @example
   *   // Inside an HTTP handler — enqueued after response:
   *   InitiatePayin.dispatchAfterResponse({ payinId: "pi_123" });
   */
  static dispatchAfterResponse<C extends DispatchableConstructor<unknown, unknown>>(
    this: C,
    ...args: PayloadArgs<C>
  ): void {
    const pd = buildPendingDispatch(this, args[0]);
    const buf = getDeferredBuffer();
    if (buf) {
      buf.push(pd);
    } else {
      // No HTTP context: fire-and-forget immediately.
      void (async () => {
        try {
          await pd;
        } catch (e) {
          console.error("[mq] deferred dispatch error", e);
        }
      })();
    }
  }
}

function buildPendingDispatch<C extends DispatchableConstructor<unknown, unknown>>(
  cls: C,
  payload: unknown,
): PendingDispatch<PayloadOf<C>, ResultOf<C>> {
  if (!cls.queue) {
    throw new TypeError(`${cls.name}.dispatch(): missing 'static queue' — point it at a QueueDef.`);
  }

  const options: JobsOptions & { timeout?: number } = {};

  const tries = getMetadata<number>(MQ_DEFAULT_TRIES, cls);
  if (tries !== undefined) options.attempts = tries;

  const backoff = getMetadata<number | number[] | BackoffOptions>(MQ_DEFAULT_BACKOFF, cls);
  if (backoff !== undefined) {
    if (Array.isArray(backoff)) {
      options.backoff = { type: "fixed", delay: backoff[0] ?? 0 };
    } else {
      options.backoff = backoff;
    }
  }

  const timeout = getMetadata<number>(MQ_DEFAULT_TIMEOUT, cls);
  if (timeout !== undefined) options.timeout = timeout;

  const onQueue = getMetadata<string>(MQ_DEFAULT_QUEUE, cls);

  let uniqueOptions: DispatchUniqueOptions | undefined;

  const unique = getMetadata<UniqueOptions>(MQ_UNIQUE_METADATA, cls);
  if (unique !== undefined) {
    uniqueOptions = { ...unique };
  } else {
    const uniqueUntil = getMetadata<UniqueOptions>(MQ_UNIQUE_UNTIL_PROCESSING_METADATA, cls);
    if (uniqueUntil !== undefined) {
      uniqueOptions = { ...uniqueUntil, untilProcessing: true };
    }
  }

  return new PendingDispatch<PayloadOf<C>, ResultOf<C>>({
    queueName: onQueue ?? cls.queue.name,
    jobName: cls.jobName ?? cls.name,
    payload: payload as PayloadOf<C>,
    options,
    uniqueOptions,
  });
}

export interface DispatchableConstructor<TPayload, TResult> {
  new (...args: never[]): Dispatchable<TPayload, TResult>;
  queue: QueueDef;
  jobName?: string;
  name: string;
  readonly [DISPATCHABLE_MARKER]: true;
}

type PayloadOf<C> = C extends DispatchableConstructor<infer P, unknown> ? P : never;
type ResultOf<C> = C extends DispatchableConstructor<unknown, infer R> ? R : never;
type PayloadArgs<C> = PayloadOf<C> extends void ? [] : [payload: PayloadOf<C>];

export function isDispatchableClass(
  value: unknown,
): value is DispatchableConstructor<unknown, unknown> {
  return (
    typeof value === "function" &&
    (value as { [DISPATCHABLE_MARKER]?: unknown })[DISPATCHABLE_MARKER] === true
  );
}

/**
 * Mark a `Dispatchable` subclass as a registered job. Applies `@Injectable()`
 * so the DI container injects constructor dependencies, and ensures the
 * subclass carries the dispatch marker even under aggressive transpilation
 * that drops static-field inheritance.
 *
 * (Named after Laravel's `Queueable` trait. The base class is `Dispatchable`;
 * the decorator is `@Queueable()` — together they read like
 * `@Queueable() class X extends Dispatchable {}`.)
 *
 * @example
 *   @Queueable()
 *   class InitiatePayin extends Dispatchable<{ payinId: string }> {
 *     static queue = PayinsQueueDef;
 *     constructor(private exec: CoPayinsExecutionService) { super(); }
 *     async handle({ payinId }) { await this.exec.initiatePayin(payinId); }
 *   }
 */
export function Queueable(): ClassDecorator {
  const injectable = Injectable() as (target: Function, context?: unknown) => void;
  return (target: Function, context?: unknown) => {
    injectable(target, context);
    (target as { [DISPATCHABLE_MARKER]?: boolean })[DISPATCHABLE_MARKER] = true;
  };
}
