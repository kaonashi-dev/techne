import { afterEach, describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  JobNotUniqueError,
  Queueable,
  Unique,
  UniqueUntilProcessing,
  clearDispatcherContext,
  clearDriverContext,
  clearSyncHandlers,
  defineQueue,
  mq,
} from "../src/mq";
import { MemoryQueueDriver } from "../src/mq/drivers/memory";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq job uniqueness", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearDriverContext();
    clearSyncHandlers();
  });

  // Helper: return total pending job count (waiting + active + paused).
  // Checked instead of just "waiting" because pausing the queue moves new
  // jobs into the "paused" state.
  async function pendingCount(queue: any): Promise<number> {
    const counts = await queue.getJobCounts();
    return (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.paused ?? 0);
  }

  // ---------------------------------------------------------------------------
  // 1. Same key dispatched twice within TTL → second dispatch silently dropped
  // ---------------------------------------------------------------------------
  test("second dispatch within TTL is silently dropped (@Unique on Dispatchable)", async () => {
    const Q = defineQueue({
      name: "unique-drop",
      jobs: { send: {} as { userId: string } },
    });

    @Unique({ for: 60_000 })
    @Queueable()
    class SendMsg extends Dispatchable<{ userId: string }> {
      static override queue = Q;
      static override jobName = "send";
      async handle() {}
    }

    // No providers → no worker → jobs accumulate as "waiting".
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    const rawQueue = ctx.get<any>(`Mq_${Q.name}`);

    await SendMsg.dispatch({ userId: "u1" });
    // Second dispatch with the same payload — should be dropped.
    await SendMsg.dispatch({ userId: "u1" });

    expect(await pendingCount(rawQueue)).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Same key dispatched AFTER TTL expires → second dispatch succeeds
  // ---------------------------------------------------------------------------
  test("dispatch after TTL expiry succeeds (driver level)", async () => {
    const driver = new MemoryQueueDriver();

    // Acquire with a very short TTL (50 ms).
    const first = await driver.acquireUniqueLock("q:job:{}", 50);
    expect(first).toBe(true);

    // Still locked — second attempt should fail.
    const before = await driver.acquireUniqueLock("q:job:{}", 50);
    expect(before).toBe(false);

    // Wait for TTL to expire.
    await sleep(60);

    // Lock has expired — should succeed now.
    const after = await driver.acquireUniqueLock("q:job:{}", 60_000);
    expect(after).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. throwIfLocked: true → second dispatch throws JobNotUniqueError
  // ---------------------------------------------------------------------------
  test("throwIfLocked throws JobNotUniqueError on duplicate", async () => {
    const Q = defineQueue({
      name: "unique-throw",
      jobs: { send: {} as { userId: string } },
    });

    @Unique({ for: 60_000, throwIfLocked: true })
    @Queueable()
    class UniqueThrowJob extends Dispatchable<{ userId: string }> {
      static override queue = Q;
      static override jobName = "send";
      async handle() {}
    }

    // No worker — jobs stay in queue.
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    // First dispatch acquires the lock.
    await UniqueThrowJob.dispatch({ userId: "u2" });

    // Second dispatch should throw JobNotUniqueError.
    await expect(
      (async () => {
        await UniqueThrowJob.dispatch({ userId: "u2" });
      })(),
    ).rejects.toBeInstanceOf(JobNotUniqueError);
  });

  // ---------------------------------------------------------------------------
  // 4. @UniqueUntilProcessing: lock released when worker claims the job
  // ---------------------------------------------------------------------------
  test("@UniqueUntilProcessing allows re-dispatch once processing starts", async () => {
    const Q = defineQueue({
      name: "unique-until-proc",
      jobs: { work: {} as { id: string } },
      worker: { blockTimeout: 100, lockDuration: 500 },
    });

    // A latch that keeps the job running until we release it.
    let releaseSignal!: () => void;
    const holdSignal = new Promise<void>((r) => {
      releaseSignal = r;
    });
    let jobStarted = false;

    @UniqueUntilProcessing({ for: 60_000 })
    @Queueable()
    class UUPJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "work";
      async handle() {
        jobStarted = true;
        await holdSignal;
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [UUPJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // First dispatch — lock acquired.
    await UUPJob.dispatch({ id: "item-1" });

    // Wait until the worker has started processing (lock released at that point).
    await sleep(200);
    expect(jobStarted).toBe(true);

    // Lock should be released now — a second dispatch should NOT be dropped.
    let secondEnqueued = false;
    await UUPJob.dispatch({ id: "item-1" });
    secondEnqueued = true;
    expect(secondEnqueued).toBe(true);

    // Release the held job.
    releaseSignal();
    await sleep(50);
  });

  // ---------------------------------------------------------------------------
  // 5. Custom key function: only same computed key deduplicates
  // ---------------------------------------------------------------------------
  test("custom key function deduplicates by computed key only", async () => {
    const Q = defineQueue({
      name: "unique-custom-key",
      jobs: { notify: {} as { userId: string; region: string } },
    });

    @Unique({
      for: 60_000,
      key: (payload) => (payload as { userId: string }).userId,
    })
    @Queueable()
    class NotifyJob extends Dispatchable<{ userId: string; region: string }> {
      static override queue = Q;
      static override jobName = "notify";
      async handle() {}
    }

    // No worker — jobs stay in queue.
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    const rawQueue = ctx.get<any>(`Mq_${Q.name}`);

    // Same userId, different region → should deduplicate (only 1 job queued).
    await NotifyJob.dispatch({ userId: "u10", region: "eu" });
    await NotifyJob.dispatch({ userId: "u10", region: "us" }); // duplicate by userId key

    // Different userId → different key → separate job.
    await NotifyJob.dispatch({ userId: "u11", region: "us" });

    expect(await pendingCount(rawQueue)).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 6. Memory driver: basic lock/release correctness
  // ---------------------------------------------------------------------------
  describe("MemoryQueueDriver lock primitives", () => {
    test("acquireUniqueLock returns true on first call", async () => {
      const driver = new MemoryQueueDriver();
      const acquired = await driver.acquireUniqueLock("lock-a", 60_000);
      expect(acquired).toBe(true);
    });

    test("acquireUniqueLock returns false if lock is still held", async () => {
      const driver = new MemoryQueueDriver();
      await driver.acquireUniqueLock("lock-b", 60_000);
      const second = await driver.acquireUniqueLock("lock-b", 60_000);
      expect(second).toBe(false);
    });

    test("releaseUniqueLock allows re-acquisition", async () => {
      const driver = new MemoryQueueDriver();
      await driver.acquireUniqueLock("lock-c", 60_000);
      await driver.releaseUniqueLock("lock-c");
      const after = await driver.acquireUniqueLock("lock-c", 60_000);
      expect(after).toBe(true);
    });

    test("releaseUniqueLock is a no-op for missing keys", async () => {
      const driver = new MemoryQueueDriver();
      // Should not throw.
      await expect(driver.releaseUniqueLock("nonexistent")).resolves.toBeUndefined();
    });

    test("lock expires after TTL (lazy expiry check)", async () => {
      const driver = new MemoryQueueDriver();
      await driver.acquireUniqueLock("lock-d", 30);
      await sleep(40);
      const after = await driver.acquireUniqueLock("lock-d", 60_000);
      expect(after).toBe(true);
    });

    test("independent keys do not interfere", async () => {
      const driver = new MemoryQueueDriver();
      const a1 = await driver.acquireUniqueLock("key-x", 60_000);
      const b1 = await driver.acquireUniqueLock("key-y", 60_000);
      const a2 = await driver.acquireUniqueLock("key-x", 60_000);
      const b2 = await driver.acquireUniqueLock("key-y", 60_000);
      expect(a1).toBe(true);
      expect(b1).toBe(true);
      expect(a2).toBe(false);
      expect(b2).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: @Unique with different payloads → each key is independent
  // ---------------------------------------------------------------------------
  test("@Unique allows distinct payloads to be queued independently", async () => {
    const Q = defineQueue({
      name: "unique-multi",
      jobs: { process: {} as { itemId: string } },
    });

    @Unique({ for: 60_000 })
    @Queueable()
    class ProcessItem extends Dispatchable<{ itemId: string }> {
      static override queue = Q;
      static override jobName = "process";
      async handle() {}
    }

    // No worker — jobs accumulate in the queue.
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    const rawQueue = ctx.get<any>(`Mq_${Q.name}`);

    await ProcessItem.dispatch({ itemId: "item-42" });
    await ProcessItem.dispatch({ itemId: "item-42" }); // duplicate — dropped
    await ProcessItem.dispatch({ itemId: "item-99" }); // different payload — allowed

    // item-42 once + item-99 once = 2 pending jobs.
    expect(await pendingCount(rawQueue)).toBe(2);
  });
});
