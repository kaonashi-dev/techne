import { getBatchStore, setBatchStore } from "./batch-context";
import type { BatchProgress, BatchStore } from "./batch-store";
import { getChainStore, setChainStore } from "./chain-context";
import type { ChainStore } from "./chain-store";
import type { QueueDef } from "./define-queue";
import type { DispatchableConstructor } from "./dispatchable";
import {
  clearDispatcherContext,
  setDispatcherContext,
  type QueueResolver,
} from "./dispatcher";
import type { BatchCallbacks, ChainStepSpec, JobsOptions } from "./types";

/**
 * A single recorded dispatch made during `fakeQueue.use(...)`.
 *
 * Mirrors the arguments passed to the underlying `queue.add(name, data, opts)`
 * plus the queue the dispatcher targeted.
 */
export interface DispatchRecord<TPayload = unknown> {
  readonly queueName: string;
  readonly jobName: string;
  readonly payload: TPayload;
  readonly options: JobsOptions;
}

/** A chain dispatched during `fakeQueue.use(...)`. */
export interface ChainRecord {
  readonly chainId: string;
  readonly firstStep: DispatchRecord;
  readonly remainingSteps: ReadonlyArray<ChainStepSpec>;
  readonly catchSpec?: ChainStepSpec;
}

/** A batch dispatched during `fakeQueue.use(...)`. */
export interface BatchRecord {
  readonly batchId: string;
  readonly jobs: ReadonlyArray<DispatchRecord>;
  readonly total: number;
  readonly callbacks: BatchCallbacks;
}

/** Either a Dispatchable class or a raw `jobName` string. */
export type DispatchTarget =
  | DispatchableConstructor<unknown, unknown>
  | string;

// ── Internal helpers ─────────────────────────────────────────────────────────

function isDispatchableClass(t: DispatchTarget): t is DispatchableConstructor<unknown, unknown> {
  return typeof t !== "string";
}

function targetMatches(record: DispatchRecord, target: DispatchTarget): boolean {
  if (!isDispatchableClass(target)) return record.jobName === target;
  return (
    record.queueName === target.queue.name &&
    record.jobName === (target.jobName ?? target.name)
  );
}

function targetLabel(target: DispatchTarget): string {
  if (!isDispatchableClass(target)) return `'${target}'`;
  return target.name;
}

function fail(message: string): never {
  throw new Error(`[fakeQueue] ${message}`);
}

// ── Recording stores ──────────────────────────────────────────────────────────

class RecordingChainStore implements ChainStore {
  public readonly saved = new Map<
    string,
    { steps: ChainStepSpec[]; catchSpec?: ChainStepSpec }
  >();

  async save(
    chainId: string,
    steps: ChainStepSpec[],
    catchSpec?: ChainStepSpec,
  ): Promise<void> {
    this.saved.set(chainId, { steps: [...steps], catchSpec });
  }
  async next(): Promise<ChainStepSpec | null> {
    return null;
  }
  async catch(): Promise<ChainStepSpec | null> {
    return null;
  }
  async cleanup(): Promise<void> {
    /* no-op */
  }
}

const ZERO_PROGRESS: BatchProgress = {
  total: 0,
  completed: 0,
  failed: 0,
  cancelled: false,
};

class RecordingBatchStore implements BatchStore {
  public readonly saved = new Map<
    string,
    { total: number; callbacks: BatchCallbacks }
  >();

  async create(
    batchId: string,
    total: number,
    callbacks: BatchCallbacks,
  ): Promise<void> {
    this.saved.set(batchId, { total, callbacks });
  }
  async incrementCompleted(): Promise<BatchProgress> {
    return ZERO_PROGRESS;
  }
  async incrementFailed(): Promise<BatchProgress> {
    return ZERO_PROGRESS;
  }
  async incrementTotal(): Promise<void> {
    /* no-op */
  }
  async cancel(): Promise<void> {
    /* no-op */
  }
  async isCancelled(): Promise<boolean> {
    return false;
  }
  async getCallbacks(): Promise<BatchCallbacks | null> {
    return null;
  }
  async getState(): Promise<BatchProgress | null> {
    return null;
  }
  async cleanup(): Promise<void> {
    /* no-op */
  }
}

// ── Public surface ────────────────────────────────────────────────────────────

/**
 * Test double for the MQ dispatch layer. Records every dispatch made during
 * `use()` without ever touching a real driver, and exposes assertion methods
 * for use in test bodies.
 *
 * @example
 *   const q = fakeQueue();
 *   await q.use(async () => {
 *     await usersService.signup(input);
 *   });
 *   q.assertDispatched(SendWelcomeEmail);
 */
export class FakeQueue {
  private readonly records: DispatchRecord[] = [];
  private readonly chainStore = new RecordingChainStore();
  private readonly batchStore = new RecordingBatchStore();

  /**
   * Install the fake as the active dispatcher, chain store, and batch store;
   * run `fn` inside; restore the previous context on exit. Safe to nest, and
   * safe to invoke multiple times on the same FakeQueue (records accumulate).
   */
  async use<T>(fn: () => T | Promise<T>): Promise<T> {
    const resolver: QueueResolver = (queueName) =>
      ({
        add: async (jobName: string, data: unknown, opts: JobsOptions = {}) => {
          this.records.push({
            queueName,
            jobName,
            payload: data,
            options: { ...opts },
          });
          return { id: `fake-${this.records.length}` };
        },
      }) as unknown as ReturnType<QueueResolver>;

    const prevChainStore = getChainStore();
    const prevBatchStore = getBatchStore();
    setDispatcherContext(resolver);
    setChainStore(this.chainStore);
    setBatchStore(this.batchStore);

    try {
      return await fn();
    } finally {
      clearDispatcherContext();
      if (prevChainStore) setChainStore(prevChainStore);
      if (prevBatchStore) setBatchStore(prevBatchStore);
    }
  }

  // ── Inspection ─────────────────────────────────────────────────────────────

  /** All recorded dispatches, in dispatch order. */
  all(): ReadonlyArray<DispatchRecord> {
    return [...this.records];
  }

  /** Recorded dispatches that match `target`. */
  filter(target: DispatchTarget): ReadonlyArray<DispatchRecord> {
    return this.records.filter((r) => targetMatches(r, target));
  }

  /** Every chain dispatched during `use()`. */
  chains(): ReadonlyArray<ChainRecord> {
    const out: ChainRecord[] = [];
    for (const [chainId, entry] of this.chainStore.saved) {
      const firstStep = this.records.find((r) => r.options.__chainId === chainId);
      if (!firstStep) continue;
      out.push({
        chainId,
        firstStep,
        remainingSteps: entry.steps,
        catchSpec: entry.catchSpec,
      });
    }
    return out;
  }

  /** Every batch dispatched during `use()`. */
  batches(): ReadonlyArray<BatchRecord> {
    const out: BatchRecord[] = [];
    for (const [batchId, entry] of this.batchStore.saved) {
      const jobs = this.records.filter((r) => r.options.__batchId === batchId);
      out.push({ batchId, jobs, total: entry.total, callbacks: entry.callbacks });
    }
    return out;
  }

  // ── Dispatch assertions ────────────────────────────────────────────────────

  /**
   * Assert `target` was dispatched at least once. When `predicate` is passed,
   * assert at least one matching dispatch satisfies it.
   */
  assertDispatched(
    target: DispatchTarget,
    predicate?: (payload: unknown, record: DispatchRecord) => boolean,
  ): void {
    const matches = this.filter(target);
    if (matches.length === 0) {
      const total = this.records.length;
      fail(
        `Expected ${targetLabel(target)} to have been dispatched; got 0 matching dispatches (${total} total).`,
      );
    }
    if (predicate && !matches.some((r) => predicate(r.payload, r))) {
      fail(
        `Expected ${targetLabel(target)} to have been dispatched matching predicate; ${matches.length} dispatches did not match.`,
      );
    }
  }

  /** Assert `target` was dispatched exactly `times`. */
  assertDispatchedTimes(target: DispatchTarget, times: number): void {
    const actual = this.filter(target).length;
    if (actual !== times) {
      fail(
        `Expected ${targetLabel(target)} to have been dispatched ${times}x; got ${actual}.`,
      );
    }
  }

  /** Assert `target` was never dispatched. */
  assertNotDispatched(target: DispatchTarget): void {
    const actual = this.filter(target).length;
    if (actual > 0) {
      fail(
        `Expected ${targetLabel(target)} not to have been dispatched; got ${actual}.`,
      );
    }
  }

  /** Assert no dispatches at all were recorded. */
  assertNothingDispatched(): void {
    if (this.records.length > 0) {
      const names = this.records.map((r) => r.jobName).join(", ");
      fail(`Expected nothing dispatched; got ${this.records.length}: ${names}.`);
    }
  }

  /** Assert no dispatches were made to a specific queue. */
  assertNothingDispatchedOn(queue: QueueDef | string): void {
    const queueName = typeof queue === "string" ? queue : queue.name;
    const matches = this.records.filter((r) => r.queueName === queueName);
    if (matches.length > 0) {
      fail(
        `Expected nothing dispatched on queue '${queueName}'; got ${matches.length}.`,
      );
    }
  }

  // ── Chain assertion ────────────────────────────────────────────────────────

  /**
   * Assert at least one chain was dispatched whose steps match `expected` in
   * order, by Dispatchable class identity (queue + jobName).
   */
  assertChained(expected: DispatchableConstructor<unknown, unknown>[]): void {
    const allChains = this.chains();
    if (allChains.length === 0) {
      fail("Expected a chain to have been dispatched; got 0 chains.");
    }

    const expectedSteps = expected.map((cls) => ({
      queueName: cls.queue.name,
      jobName: cls.jobName ?? cls.name,
    }));

    const ok = allChains.some((chain) => {
      const actualSteps = [
        { queueName: chain.firstStep.queueName, jobName: chain.firstStep.jobName },
        ...chain.remainingSteps.map((s) => ({
          queueName: s.queueName,
          jobName: s.jobName,
        })),
      ];
      if (actualSteps.length !== expectedSteps.length) return false;
      return expectedSteps.every(
        (e, i) =>
          actualSteps[i]!.queueName === e.queueName &&
          actualSteps[i]!.jobName === e.jobName,
      );
    });

    if (!ok) {
      const want = expected.map((c) => c.name).join(" → ");
      fail(
        `Expected a chain matching [${want}]; got ${allChains.length} chain(s), none matched.`,
      );
    }
  }

  // ── Batch assertion ────────────────────────────────────────────────────────

  /**
   * Assert at least one batch was dispatched that satisfies `predicate`. The
   * predicate receives the `BatchRecord` so it can inspect total, jobs, and
   * callbacks.
   */
  assertBatched(predicate: (batch: BatchRecord) => boolean): void {
    const all = this.batches();
    if (!all.some(predicate)) {
      fail(
        `Expected a batch matching predicate; got ${all.length} batch(es), none matched.`,
      );
    }
  }
}

/**
 * Build a fresh fake queue for a test. Each call returns an independent
 * recorder — safe to use multiple fakes within the same test file as long as
 * `use()` invocations don't overlap (they share module-level dispatch state).
 */
export function fakeQueue(): FakeQueue {
  return new FakeQueue();
}
