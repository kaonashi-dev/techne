import { getChainStore } from "./chain-context";
import { dispatchToQueue } from "./dispatcher";
import { PendingDispatch, toPendingDispatchSpec } from "./pending-dispatch";
import type { ChainStepSpec } from "./types";

/**
 * Build a sequential job chain. Jobs are enqueued one at a time — the next
 * step is only dispatched after the previous step completes successfully.
 *
 * @example
 *   await chain([
 *     SendEmail.dispatch({ to: "user@example.com" }),
 *     UpdateRecord.dispatch({ id: 42 }),
 *   ])
 *     .catch(NotifyAdmin.dispatch({ reason: "chain failed" }))
 *     .dispatch();
 */
export function chain(steps: PendingDispatch[]): ChainBuilder {
  // Park all builders so awaiting them individually is a no-op.
  for (const step of steps) {
    step._parked = true;
  }
  return new ChainBuilder(steps);
}

export class ChainBuilder {
  private _catchSpec?: ChainStepSpec;

  constructor(private readonly steps: PendingDispatch[]) {}

  /**
   * Register a catch handler that is dispatched when any step in the chain
   * fails permanently (all retries exhausted). Remaining steps after the
   * failed step are skipped.
   */
  // oxlint-disable-next-line no-thenable -- catch is a fluent API method, not Promise.catch
  catch(handler: PendingDispatch): this {
    handler._parked = true;
    this._catchSpec = toPendingDispatchSpec(handler);
    return this;
  }

  /** Enqueue the first step of the chain and persist the remaining steps. */
  async dispatch(): Promise<void> {
    if (this.steps.length === 0) return;

    const specs = this.steps.map(toPendingDispatchSpec);

    if (specs.length === 1) {
      const s = specs[0]!;
      await dispatchToQueue(s.queueName, s.jobName, s.payload, s.options);
      return;
    }

    const chainId = crypto.randomUUID();
    const store = getChainStore();
    if (!store) {
      throw new Error(
        "No ChainStore registered. Is the mq() plugin installed?",
      );
    }

    await store.save(chainId, specs.slice(1), this._catchSpec);

    const s = specs[0]!;
    await dispatchToQueue(s.queueName, s.jobName, s.payload, {
      ...s.options,
      __chainId: chainId,
      __chainStepIndex: 0,
    });
  }
}
