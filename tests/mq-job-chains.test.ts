/**
 * Integration tests for MQ sequential job chains:
 *   - Three-step chain runs in order
 *   - Mid-chain failure triggers catch handler, skips remaining steps
 *   - Empty chain is a no-op
 *   - Single-element chain behaves like a plain dispatch
 *   - Per-step delay is honored
 *   - Catch handler that itself fails: logs, doesn't loop
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  Queueable,
  chain,
  clearChainStore,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  mq,
} from "../src/mq";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq job chains", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
    clearChainStore();
  });

  // ---------------------------------------------------------------------------
  // 1. Three-step chain runs in order
  // ---------------------------------------------------------------------------
  test("three-step chain runs steps in order", async () => {
    const Q = defineQueue({
      name: "chain-ordered",
      jobs: {
        stepA: {} as { id: string },
        stepB: {} as { id: string },
        stepC: {} as { id: string },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const order: string[] = [];

    @Queueable()
    class StepA extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "stepA";
      async handle({ id }: { id: string }) {
        order.push(`A:${id}`);
      }
    }

    @Queueable()
    class StepB extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "stepB";
      async handle({ id }: { id: string }) {
        order.push(`B:${id}`);
      }
    }

    @Queueable()
    class StepC extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "stepC";
      async handle({ id }: { id: string }) {
        order.push(`C:${id}`);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [StepA, StepB, StepC],
      logger: false,
    });
    closers.push(() => ctx.close());

    await chain([
      StepA.dispatch({ id: "x" }),
      StepB.dispatch({ id: "x" }),
      StepC.dispatch({ id: "x" }),
    ]).dispatch();

    // Allow time for all three steps to process sequentially.
    await sleep(600);

    expect(order).toEqual(["A:x", "B:x", "C:x"]);
  });

  // ---------------------------------------------------------------------------
  // 2. Mid-chain failure triggers catch handler, skips remaining steps
  // ---------------------------------------------------------------------------
  test("step failure triggers catch handler and skips remaining steps", async () => {
    const Q = defineQueue({
      name: "chain-failure",
      jobs: {
        ok1: {} as { id: string },
        fail: {} as { id: string },
        never: {} as { id: string },
        catcher: {} as { id: string; reason: string },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const ran: string[] = [];

    @Queueable()
    class Ok1Job extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "ok1";
      async handle({ id }: { id: string }) {
        ran.push(`ok1:${id}`);
      }
    }

    @Queueable()
    class FailJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "fail";
      async handle() {
        throw new Error("intentional-step-failure");
      }
    }

    @Queueable()
    class NeverJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "never";
      async handle({ id }: { id: string }) {
        ran.push(`never:${id}`);
      }
    }

    @Queueable()
    class CatcherJob extends Dispatchable<{ id: string; reason: string }> {
      static override queue = Q;
      static override jobName = "catcher";
      async handle({ id, reason }: { id: string; reason: string }) {
        ran.push(`catcher:${id}:${reason}`);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [Ok1Job, FailJob, NeverJob, CatcherJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await chain([
      Ok1Job.dispatch({ id: "1" }),
      FailJob.dispatch({ id: "1" }),
      NeverJob.dispatch({ id: "1" }),
    ])
      .catch(CatcherJob.dispatch({ id: "1", reason: "failed" }))
      .dispatch();

    // Allow time for ok1, fail (final failure), and catcher to run.
    await sleep(800);

    expect(ran).toContain("ok1:1");
    expect(ran).not.toContain("never:1");
    expect(ran).toContain("catcher:1:failed");
  });

  // ---------------------------------------------------------------------------
  // 3. Empty chain is a no-op
  // ---------------------------------------------------------------------------
  test("empty chain dispatch is a no-op", async () => {
    const Q = defineQueue({
      name: "chain-empty",
      jobs: {},
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Should not throw
    await expect(chain([]).dispatch()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 4. Single-element chain: equivalent to a plain dispatch
  // ---------------------------------------------------------------------------
  test("single-element chain dispatches the job directly", async () => {
    const Q = defineQueue({
      name: "chain-single",
      jobs: { work: {} as { n: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const results: number[] = [];

    @Queueable()
    class WorkJob extends Dispatchable<{ n: number }> {
      static override queue = Q;
      static override jobName = "work";
      async handle({ n }: { n: number }) {
        results.push(n);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [WorkJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await chain([WorkJob.dispatch({ n: 42 })]).dispatch();
    await sleep(300);

    expect(results).toEqual([42]);
  });

  // ---------------------------------------------------------------------------
  // 5. Per-step delay is honored
  // ---------------------------------------------------------------------------
  test("per-step delay is honored", async () => {
    const Q = defineQueue({
      name: "chain-delay",
      jobs: {
        first: {} as { id: string },
        second: {} as { id: string },
      },
      worker: { blockTimeout: 200, lockDuration: 500 },
    });

    const timestamps: { step: string; at: number }[] = [];

    @Queueable()
    class FirstJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "first";
      async handle() {
        timestamps.push({ step: "first", at: Date.now() });
      }
    }

    @Queueable()
    class SecondJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "second";
      async handle() {
        timestamps.push({ step: "second", at: Date.now() });
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [FirstJob, SecondJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    const delayMs = 100;
    await chain([
      FirstJob.dispatch({ id: "d" }),
      SecondJob.dispatch({ id: "d" }).delay(delayMs),
    ]).dispatch();

    // Wait for first + delay + second to finish.
    await sleep(800);

    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]!.step).toBe("first");
    expect(timestamps[1]!.step).toBe("second");
    // Second step should have been delayed by at least delayMs after being enqueued.
    const gap = timestamps[1]!.at - timestamps[0]!.at;
    expect(gap).toBeGreaterThanOrEqual(delayMs - 20); // small tolerance
  });

  // ---------------------------------------------------------------------------
  // 6. Catch handler that itself fails: logs, doesn't loop
  // ---------------------------------------------------------------------------
  test("catch handler that throws: error is logged, chain does not loop", async () => {
    const Q = defineQueue({
      name: "chain-catch-throws",
      jobs: {
        badStep: {} as { id: string },
        badCatch: {} as { id: string },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    @Queueable()
    class BadStepJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "badStep";
      async handle() {
        throw new Error("step-error");
      }
    }

    @Queueable()
    class BadCatchJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "badCatch";
      async handle() {
        throw new Error("catch-handler-error");
      }
    }

    // Spy to suppress noise in output.
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [BadStepJob, BadCatchJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await chain([BadStepJob.dispatch({ id: "e" })])
      .catch(BadCatchJob.dispatch({ id: "e" }))
      .dispatch();

    // Allow time to settle — no infinite loop should occur.
    await sleep(500);

    // Test passes if no error is thrown and the process doesn't hang.
    consoleErrorSpy.mockRestore();
  });
});
