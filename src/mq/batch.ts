import { getBatchStore } from "./batch-context";
import type { BatchStore } from "./batch-store";
import { dispatchToQueue } from "./dispatcher";
import { PendingDispatch, toPendingDispatchSpec } from "./pending-dispatch";
import type { BatchCallbacks } from "./types";

/**
 * Create a fan-out batch from an array of pending-dispatch builders.
 *
 * ```ts
 * const handle = await batch([
 *   SendEmailJob.dispatch({ to: "alice@example.com" }),
 *   SendEmailJob.dispatch({ to: "bob@example.com" }),
 * ])
 *   .then(NotifyAdminJob.dispatch({ event: "batch-done" }))
 *   .catch(AlertOpsJob.dispatch({ event: "batch-failed" }))
 *   .finally(CleanupJob.dispatch({ event: "batch-finished" }))
 *   .dispatch();
 * ```
 */
export function batch(jobs: PendingDispatch[]): BatchBuilder {
  return new BatchBuilder(jobs);
}

export class BatchBuilder {
  private _then?: PendingDispatch;
  private _catch?: PendingDispatch;
  private _finally?: PendingDispatch;

  constructor(private readonly jobs: PendingDispatch[]) {
    // Park all jobs so that awaiting them directly is a no-op.
    for (const j of jobs) {
      j._parked = true;
    }
  }

  /**
   * Job to dispatch after the batch finishes with zero failures.
   * The passed builder is parked (won't auto-enqueue on await).
   */
  // oxlint-disable-next-line no-thenable -- intentional: fluent API mirrors Promise chain naming
  then(handler: PendingDispatch): this {
    handler._parked = true;
    this._then = handler;
    return this;
  }

  /**
   * Job to dispatch after the batch finishes with one or more failures.
   * The passed builder is parked (won't auto-enqueue on await).
   */
  catch(handler: PendingDispatch): this {
    handler._parked = true;
    this._catch = handler;
    return this;
  }

  /**
   * Job to dispatch after the batch finishes, regardless of outcome.
   * The passed builder is parked (won't auto-enqueue on await).
   */
  finally(handler: PendingDispatch): this {
    handler._parked = true;
    this._finally = handler;
    return this;
  }

  /** Enqueue all jobs and register the completion barrier. Returns a BatchHandle. */
  async dispatch(): Promise<BatchHandle> {
    const store = getBatchStore();
    if (!store) throw new Error("No BatchStore. Is the mq() plugin installed?");

    const batchId = crypto.randomUUID();
    const total = this.jobs.length;

    // oxlint-disable-next-line no-thenable -- `then` is a data key, not a Promise callback
    const callbacks: BatchCallbacks = {
      then: this._then ? toPendingDispatchSpec(this._then) : undefined,
      catch: this._catch ? toPendingDispatchSpec(this._catch) : undefined,
      finally: this._finally ? toPendingDispatchSpec(this._finally) : undefined,
    };

    await store.create(batchId, total, callbacks);

    // If the batch is empty, fire callbacks immediately.
    if (total === 0) {
      await fireBatchCallbacks(batchId, store, 0);
      return new BatchHandle(batchId, store);
    }

    for (const job of this.jobs) {
      const spec = toPendingDispatchSpec(job);
      await dispatchToQueue(spec.queueName, spec.jobName, spec.payload, {
        ...spec.options,
        __batchId: batchId,
      });
    }

    return new BatchHandle(batchId, store);
  }
}

export class BatchHandle {
  constructor(
    public readonly id: string,
    private readonly store: BatchStore,
  ) {}

  /** Current progress snapshot. */
  async progress(): Promise<{ total: number; completed: number; failed: number; cancelled: boolean }> {
    const state = await this.store.getState(this.id);
    return state ?? { total: 0, completed: 0, failed: 0, cancelled: false };
  }

  /** Best-effort cancel: sets the cancelled flag, checked on active event. */
  async cancel(): Promise<void> {
    await this.store.cancel(this.id);
  }

  /**
   * Add more jobs to an in-flight batch. The total is increased atomically
   * so the barrier won't fire until these new jobs also complete.
   */
  async addJobs(jobs: PendingDispatch[]): Promise<void> {
    await this.store.incrementTotal(this.id, jobs.length);
    for (const job of jobs) {
      job._parked = false;
      const spec = toPendingDispatchSpec(job);
      await dispatchToQueue(spec.queueName, spec.jobName, spec.payload, {
        ...spec.options,
        __batchId: this.id,
      });
    }
  }
}

/**
 * Dispatch the then/catch/finally callbacks for a completed batch, then
 * clean up the store entry.
 *
 * `failed` must be passed in because the store entry may already be gone
 * by the time we call getCallbacks.
 */
export async function fireBatchCallbacks(
  batchId: string,
  store: BatchStore,
  failed: number,
): Promise<void> {
  const callbacks = await store.getCallbacks(batchId);
  await store.cleanup(batchId);
  if (!callbacks) return;

  if (failed === 0 && callbacks.then) {
    const s = callbacks.then;
    await dispatchToQueue(s.queueName, s.jobName, s.payload, s.options);
  }
  if (failed > 0 && callbacks.catch) {
    const s = callbacks.catch;
    await dispatchToQueue(s.queueName, s.jobName, s.payload, s.options);
  }
  if (callbacks.finally) {
    const s = callbacks.finally;
    await dispatchToQueue(s.queueName, s.jobName, s.payload, s.options);
  }
}
