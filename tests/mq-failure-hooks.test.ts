/**
 * Integration tests for MQ failure lifecycle hooks:
 *   - Dispatchable.failed() — fires only after the final attempt
 *   - @OnFailure("job-name") on a @Processor class — fires for the matching job
 *   - Failure handler that itself throws — error is logged, job is not re-enqueued
 *   - Duplicate failure handler guard — startup throws descriptively
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  On,
  OnFailure,
  Processor,
  Queueable,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  mq,
  type Job,
} from "../src/mq";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq failure hooks", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
  });

  // ---------------------------------------------------------------------------
  // 1. Dispatchable.failed() fires only after the FINAL attempt
  // ---------------------------------------------------------------------------
  test("Dispatchable.failed() fires once after all retries are exhausted", async () => {
    const Q = defineQueue({
      name: "fh-dispatchable-retry",
      jobs: { run: {} as { id: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const handleCalls: string[] = [];
    const failedCalls: Array<{ payload: { id: string }; err: Error }> = [];

    @Queueable()
    class RetryJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";

      async handle({ id }: { id: string }) {
        handleCalls.push(id);
        throw new Error("intentional-failure");
      }

      async failed(payload: { id: string }, err: Error) {
        failedCalls.push({ payload, err });
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [RetryJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // 2 attempts, no backoff for speed
    await RetryJob.dispatch({ id: "job-1" }).tries(2).backoff(0);

    // Wait long enough for both attempts + failure handler
    await sleep(300);

    expect(handleCalls).toHaveLength(2);
    expect(failedCalls).toHaveLength(1);
    expect(failedCalls[0]!.payload).toEqual({ id: "job-1" });
    expect(failedCalls[0]!.err.message).toBe("intentional-failure");
  });

  // ---------------------------------------------------------------------------
  // 2. @OnFailure("job-name") on a @Processor class fires for the right job
  // ---------------------------------------------------------------------------
  test("@OnFailure fires for the matching job name on a @Processor class", async () => {
    const Q = defineQueue({
      name: "fh-processor",
      jobs: {
        "task-a": {} as { val: number },
        "task-b": {} as { val: number },
      },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const failedA: number[] = [];
    const failedB: number[] = [];

    @Processor(Q, { blockTimeout: 10, lockDuration: 200 })
    class TaskProcessor {
      @On("task-a")
      handleA(_job: Job<{ val: number }>) {
        throw new Error("a-failure");
      }

      @On("task-b")
      handleB(_job: Job<{ val: number }>) {
        throw new Error("b-failure");
      }

      @OnFailure("task-a")
      onTaskAFailed(payload: { val: number }, _err: Error) {
        failedA.push(payload.val);
      }

      @OnFailure("task-b")
      onTaskBFailed(payload: { val: number }, _err: Error) {
        failedB.push(payload.val);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [TaskProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    const queue = ctx.get<any>(`Mq_${Q.name}`);
    await queue.add("task-a", { val: 1 }, { attempts: 1 });
    await queue.add("task-b", { val: 2 }, { attempts: 1 });

    await sleep(200);

    expect(failedA).toEqual([1]);
    expect(failedB).toEqual([2]);
  });

  // ---------------------------------------------------------------------------
  // 3. A failure handler that itself throws: error is logged, not re-enqueued
  // ---------------------------------------------------------------------------
  test("a failure handler that throws logs the error and does not re-enqueue the job", async () => {
    const Q = defineQueue({
      name: "fh-handler-throws",
      jobs: { run: {} as { id: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    @Queueable()
    class ThrowingFailureJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";

      async handle() {
        throw new Error("primary-failure");
      }

      async failed() {
        throw new Error("failure-handler-also-throws");
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [ThrowingFailureJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await ThrowingFailureJob.dispatch({ id: "j1" }).tries(1);
    await sleep(200);

    // The error from failed() must have been logged
    expect(errorSpy).toHaveBeenCalled();
    const firstCallArgs = errorSpy.mock.calls[0]!;
    expect(String(firstCallArgs[0])).toContain("Dispatchable.failed()");

    // No jobs should be re-enqueued
    const queue = ctx.get<any>(`Mq_${Q.name}`);
    const counts = await queue.getJobCounts("waiting", "delayed", "active");
    expect(counts.waiting).toBe(0);
    expect(counts.delayed).toBe(0);
    expect(counts.active).toBe(0);

    errorSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 4. Duplicate failure handler guard
  // ---------------------------------------------------------------------------
  test("startup throws when Dispatchable.failed() and @OnFailure cover the same job", async () => {
    const Q = defineQueue({
      name: "fh-duplicate-guard",
      jobs: { run: {} as { id: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    @Queueable()
    class DupJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";

      async handle() {}

      async failed() {
        // Dispatchable-side failure handler
      }
    }

    @Processor(Q, { blockTimeout: 10, lockDuration: 200 })
    class DupProcessor {
      @On("run")
      handleRun(_job: Job) {}

      @OnFailure("run")
      onRunFailed(_payload: { id: string }, _err: Error) {
        // Duplicate of DupJob.failed() — should be caught at startup
      }
    }

    await expect(
      TechneFactory.createApplicationContext({
        plugins: [mq({ queues: [Q] })],
        providers: [DupJob, DupProcessor],
        logger: false,
      }),
    ).rejects.toThrow(/Duplicate failure handler for job 'run'/);
  });
});
