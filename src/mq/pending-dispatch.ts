import { dispatchToQueue, getDispatcherContext } from "./dispatcher";
import type { BackoffOptions, ChainStepSpec, JobsOptions } from "./types";

/**
 * Inline handler used by `.dispatchSync()`. The registry registers one
 * per (queue, jobName) when a Dispatchable class is discovered, so sync
 * dispatch can invoke the handler without going through the driver.
 */
export type SyncHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
) => Promise<TResult> | TResult;

const syncHandlers = new Map<string, SyncHandler>();

function syncKey(queueName: string, jobName: string): string {
  return `${queueName}::${jobName}`;
}

export function registerSyncHandler(
  queueName: string,
  jobName: string,
  handler: SyncHandler,
): void {
  syncHandlers.set(syncKey(queueName, jobName), handler);
}

export function clearSyncHandlers(): void {
  syncHandlers.clear();
}

interface PendingDispatchInit<TPayload, TResult> {
  queueName: string;
  jobName: string;
  payload: TPayload;
  enabled?: boolean;
  options?: JobsOptions;
  __resultMarker?: TResult;
}

/**
 * Fluent builder returned by every dispatch entry point. Awaiting it
 * enqueues the job; chaining methods refine the options first.
 *
 * The builder is a thenable, not a Promise — it only enqueues when
 * `await`ed (or `.then`ed). An un-awaited builder is a no-op; treat that
 * as a usage bug and surface via lint.
 */
export class PendingDispatch<TPayload = unknown, TResult = unknown>
  implements PromiseLike<unknown>
{
  private queueName: string;
  private readonly jobName: string;
  private readonly payload: TPayload;
  private enabled: boolean;
  private readonly options: JobsOptions;
  /**
   * When `true`, awaiting this builder is a no-op. Set by `chain()` and
   * `batch()` to prevent the builder from auto-enqueueing when passed as
   * an argument rather than awaited directly.
   */
  _parked = false;

  constructor(init: PendingDispatchInit<TPayload, TResult>) {
    this.queueName = init.queueName;
    this.jobName = init.jobName;
    this.payload = init.payload;
    this.enabled = init.enabled ?? true;
    this.options = { ...init.options };
  }

  /** Override the destination queue (defaults to the class/def's queue). */
  onQueue(queueName: string): this {
    this.queueName = queueName;
    return this;
  }

  /** Delay dispatch by `milliseconds` (epoch-relative). */
  delay(milliseconds: number): this {
    this.options.delay = milliseconds;
    return this;
  }

  /** Max attempts before the job is moved to failed. */
  tries(attempts: number): this {
    this.options.attempts = attempts;
    return this;
  }

  /** Backoff between retries — number (ms) or `{ type, delay }`. */
  backoff(backoff: number | number[] | BackoffOptions): this {
    if (Array.isArray(backoff)) {
      this.options.backoff = { type: "fixed", delay: backoff[0] ?? 0 };
    } else {
      this.options.backoff = backoff;
    }
    return this;
  }

  /** Per-job timeout (ms). Driver/worker enforces. */
  timeout(milliseconds: number): this {
    (this.options as JobsOptions & { timeout?: number }).timeout = milliseconds;
    return this;
  }

  /** Idempotency key — the driver dedupes by this id. */
  withId(jobId: string): this {
    this.options.jobId = jobId;
    return this;
  }

  /** Skip dispatch unless `condition` is truthy. */
  dispatchIf(condition: boolean): this {
    this.enabled = this.enabled && condition;
    return this;
  }

  /** Skip dispatch unless `condition` is falsy. */
  dispatchUnless(condition: boolean): this {
    this.enabled = this.enabled && !condition;
    return this;
  }

  /**
   * Run the handler inline instead of enqueueing. Requires a sync handler
   * registered for this (queue, jobName) pair — typically the worker
   * registers one automatically when scanning Dispatchable subclasses.
   */
  async dispatchSync(): Promise<TResult | undefined> {
    if (!this.enabled) return undefined;
    const handler = syncHandlers.get(syncKey(this.queueName, this.jobName));
    if (!handler) {
      throw new Error(
        `No sync handler registered for '${this.jobName}' on queue '${this.queueName}'. ` +
          `Register the Dispatchable class as a provider, or use 'await dispatch(...)' for the async path.`,
      );
    }
    // Ensure context is at least set — keeps error messaging consistent.
    getDispatcherContext();
    return (await handler(this.payload)) as TResult;
  }

  /**
   * Implicit terminator. Awaiting the builder enqueues via the active
   * dispatcher context. When `_parked` is true the builder is owned by a
   * `ChainBuilder` or `BatchBuilder`; awaiting it is a no-op.
   */
  // oxlint-disable-next-line no-thenable -- intentional: this is the builder's terminator
  then<TFulfilled = unknown, TRejected = never>(
    onFulfilled?: ((value: unknown) => TFulfilled | PromiseLike<TFulfilled>) | null,
    onRejected?: ((reason: unknown) => TRejected | PromiseLike<TRejected>) | null,
  ): PromiseLike<TFulfilled | TRejected> {
    const promise =
      this._parked || !this.enabled
        ? Promise.resolve(undefined)
        : dispatchToQueue(this.queueName, this.jobName, this.payload, this.options);
    return promise.then(onFulfilled, onRejected);
  }
}

/**
 * Extract a serialisable step specification from a `PendingDispatch` so it
 * can be stored in a `ChainStore` or `BatchStore`. Package-internal — not
 * re-exported from the public index.
 */
export function toPendingDispatchSpec(pd: PendingDispatch): ChainStepSpec {
  const p = pd as any;
  return {
    queueName: p.queueName,
    jobName: p.jobName,
    payload: p.payload,
    options: { ...p.options },
  };
}
