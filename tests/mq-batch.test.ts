/**
 * Integration tests for MQ fan-out batch jobs:
 *   1. All succeed → then + finally fire; catch does NOT fire.
 *   2. Any fail → catch + finally fire; then does NOT fire.
 *   3. cancel() mid-flight → cancelled flag is set on the handle.
 *   4. addJobs() extends total; callbacks fire after all complete.
 *   5. progress() reflects intermediate state.
 *   6. Empty batch → callbacks fire immediately.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  Queueable,
  batch,
  clearBatchStore,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  mq,
  setBatchStore,
} from "../src/mq";
import { MemoryBatchStore } from "../src/mq/batch-store";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq batch jobs", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
    clearBatchStore();
  });

  // ---------------------------------------------------------------------------
  // 1. All succeed — then + finally fire; catch does NOT fire
  // ---------------------------------------------------------------------------
  test("all-succeed: then + finally fire; catch does NOT fire", async () => {
    const WorkQ = defineQueue({
      name: "batch-succeed-work",
      jobs: { work: {} as { id: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });
    const CbQ = defineQueue({
      name: "batch-succeed-cb",
      jobs: {
        onSuccess: {} as { event: string },
        onFailure: {} as { event: string },
        onFinally: {} as { event: string },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const handled: number[] = [];
    const callbacks: string[] = [];

    @Queueable()
    class WorkJob extends Dispatchable<{ id: number }> {
      static override queue = WorkQ;
      static override jobName = "work";
      async handle({ id }: { id: number }) {
        handled.push(id);
      }
    }

    @Queueable()
    class SuccessCb extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onSuccess";
      async handle({ event }: { event: string }) {
        callbacks.push(`then:${event}`);
      }
    }

    @Queueable()
    class FailureCb extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onFailure";
      async handle({ event }: { event: string }) {
        callbacks.push(`catch:${event}`);
      }
    }

    @Queueable()
    class FinallyCb extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onFinally";
      async handle({ event }: { event: string }) {
        callbacks.push(`finally:${event}`);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [WorkQ, CbQ] })],
      providers: [WorkJob, SuccessCb, FailureCb, FinallyCb],
      logger: false,
    });
    closers.push(() => ctx.close());

    await batch([
      WorkJob.dispatch({ id: 1 }),
      WorkJob.dispatch({ id: 2 }),
      WorkJob.dispatch({ id: 3 }),
    ])
      // oxlint-disable-next-line no-thenable -- fluent batch API
      .then(SuccessCb.dispatch({ event: "done" }))
      .catch(FailureCb.dispatch({ event: "failed" }))
      .finally(FinallyCb.dispatch({ event: "finished" }))
      .dispatch();

    await sleep(500);

    expect(handled.sort()).toEqual([1, 2, 3]);
    expect(callbacks.filter((c) => c.startsWith("then:"))).toHaveLength(1);
    expect(callbacks.filter((c) => c.startsWith("catch:"))).toHaveLength(0);
    expect(callbacks.filter((c) => c.startsWith("finally:"))).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 2. Any fail — catch + finally fire; then does NOT fire
  // ---------------------------------------------------------------------------
  test("any-fail: catch + finally fire; then does NOT fire", async () => {
    const WorkQ = defineQueue({
      name: "batch-fail-work",
      jobs: { work: {} as { fail: boolean } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });
    const CbQ = defineQueue({
      name: "batch-fail-cb",
      jobs: {
        onSuccess: {} as { event: string },
        onFailure: {} as { event: string },
        onFinally: {} as { event: string },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const callbacks: string[] = [];

    @Queueable()
    class FailWorkJob extends Dispatchable<{ fail: boolean }> {
      static override queue = WorkQ;
      static override jobName = "work";
      async handle({ fail }: { fail: boolean }) {
        if (fail) throw new Error("intentional");
      }
    }

    @Queueable()
    class SuccessCb2 extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onSuccess";
      async handle({ event }: { event: string }) {
        callbacks.push(`then:${event}`);
      }
    }

    @Queueable()
    class FailureCb2 extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onFailure";
      async handle({ event }: { event: string }) {
        callbacks.push(`catch:${event}`);
      }
    }

    @Queueable()
    class FinallyCb2 extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onFinally";
      async handle({ event }: { event: string }) {
        callbacks.push(`finally:${event}`);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [WorkQ, CbQ] })],
      providers: [FailWorkJob, SuccessCb2, FailureCb2, FinallyCb2],
      logger: false,
    });
    closers.push(() => ctx.close());

    await batch([
      FailWorkJob.dispatch({ fail: false }),
      FailWorkJob.dispatch({ fail: true }).tries(1),
    ])
      // oxlint-disable-next-line no-thenable -- fluent batch API
      .then(SuccessCb2.dispatch({ event: "done" }))
      .catch(FailureCb2.dispatch({ event: "failed" }))
      .finally(FinallyCb2.dispatch({ event: "finished" }))
      .dispatch();

    await sleep(500);

    expect(callbacks.filter((c) => c.startsWith("then:"))).toHaveLength(0);
    expect(callbacks.filter((c) => c.startsWith("catch:"))).toHaveLength(1);
    expect(callbacks.filter((c) => c.startsWith("finally:"))).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // 3. cancel() — sets the cancelled flag on the handle
  // ---------------------------------------------------------------------------
  test("cancel() sets the cancelled flag", async () => {
    const WorkQ = defineQueue({
      name: "batch-cancel-work",
      jobs: { work: {} as { id: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    @Queueable()
    class CancelWorkJob extends Dispatchable<{ id: number }> {
      static override queue = WorkQ;
      static override jobName = "work";
      async handle() {
        // slow job so we can cancel before completion
        await sleep(150);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [WorkQ] })],
      providers: [CancelWorkJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    const handle = await batch([
      CancelWorkJob.dispatch({ id: 1 }),
      CancelWorkJob.dispatch({ id: 2 }),
    ]).dispatch();

    // Immediately cancel
    await handle.cancel();

    const prog = await handle.progress();
    expect(prog.cancelled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. addJobs() extends total; callbacks fire after all complete
  // ---------------------------------------------------------------------------
  test("addJobs() extends total and callbacks fire after all complete", async () => {
    const WorkQ = defineQueue({
      name: "batch-addjobs-work",
      jobs: { work: {} as { id: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });
    const CbQ = defineQueue({
      name: "batch-addjobs-cb",
      jobs: { onDone: {} as { event: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const handled: number[] = [];
    const callbacks: string[] = [];

    @Queueable()
    class AddJobsWorkJob extends Dispatchable<{ id: number }> {
      static override queue = WorkQ;
      static override jobName = "work";
      async handle({ id }: { id: number }) {
        handled.push(id);
      }
    }

    @Queueable()
    class DoneCb extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onDone";
      async handle({ event }: { event: string }) {
        callbacks.push(event);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [WorkQ, CbQ] })],
      providers: [AddJobsWorkJob, DoneCb],
      logger: false,
    });
    closers.push(() => ctx.close());

    const handle = await batch([AddJobsWorkJob.dispatch({ id: 1 })])
      // oxlint-disable-next-line no-thenable -- fluent batch API
      .then(DoneCb.dispatch({ event: "all-done" }))
      .dispatch();

    // Add more jobs — total goes from 1 to 3
    await handle.addJobs([
      AddJobsWorkJob.dispatch({ id: 2 }),
      AddJobsWorkJob.dispatch({ id: 3 }),
    ]);

    await sleep(500);

    expect(handled.sort()).toEqual([1, 2, 3]);
    // "then" callback fires exactly once after all 3 complete
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0]).toBe("all-done");
  });

  // ---------------------------------------------------------------------------
  // 5. progress() reflects intermediate state
  // ---------------------------------------------------------------------------
  test("progress() reflects intermediate state", async () => {
    const WorkQ = defineQueue({
      name: "batch-progress-work",
      jobs: { work: {} as { id: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    let resolveFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let firstDone = false;

    // We'll use the batch store directly to inspect intermediate state.
    const batchStore = new MemoryBatchStore();
    setBatchStore(batchStore);

    @Queueable()
    class ProgressWorkJob extends Dispatchable<{ id: number }> {
      static override queue = WorkQ;
      static override jobName = "work";
      async handle({ id }: { id: number }) {
        if (id === 1) {
          firstDone = true;
          resolveFirst();
        } else {
          // id 2 waits longer
          await sleep(300);
        }
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [WorkQ] })],
      providers: [ProgressWorkJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    const handle = await batch([
      ProgressWorkJob.dispatch({ id: 1 }),
      ProgressWorkJob.dispatch({ id: 2 }),
    ]).dispatch();

    // Wait until job 1 has completed
    await firstReady;
    await sleep(50); // small grace for the worker event to propagate

    const prog = await handle.progress();
    // At least 1 completed (id=1 finished), total=2
    expect(prog.total).toBe(2);
    expect(prog.completed).toBeGreaterThanOrEqual(1);
    expect(firstDone).toBe(true);

    await sleep(400); // wait for job 2 as well
  });

  // ---------------------------------------------------------------------------
  // 6. Empty batch → callbacks fire immediately
  // ---------------------------------------------------------------------------
  test("empty batch fires callbacks immediately", async () => {
    const CbQ = defineQueue({
      name: "batch-empty-cb",
      jobs: { onDone: {} as { event: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const callbacks: string[] = [];

    @Queueable()
    class EmptyDoneCb extends Dispatchable<{ event: string }> {
      static override queue = CbQ;
      static override jobName = "onDone";
      async handle({ event }: { event: string }) {
        callbacks.push(event);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [CbQ] })],
      providers: [EmptyDoneCb],
      logger: false,
    });
    closers.push(() => ctx.close());

    await batch([])
      // oxlint-disable-next-line no-thenable -- fluent batch API
      .then(EmptyDoneCb.dispatch({ event: "empty-done" }))
      .finally(EmptyDoneCb.dispatch({ event: "empty-finally" }))
      .dispatch();

    await sleep(200);

    // then fires because 0 failures, finally always fires
    expect(callbacks.filter((c) => c === "empty-done")).toHaveLength(1);
    expect(callbacks.filter((c) => c === "empty-finally")).toHaveLength(1);
  });
});
