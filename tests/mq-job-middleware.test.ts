/**
 * Integration tests for per-job middleware pipeline:
 *   1. Middleware runs in declared (onion) order
 *   2. Middleware that doesn't call next() skips the handler
 *   3. job.release() re-enqueues with delay without incrementing attempt count
 *   4. RateLimited releases the 3rd job within a window
 *   5. WithoutOverlapping prevents concurrent runs for the same key
 *   6. ThrottlesExceptions releases after failure threshold
 */
import { afterEach, describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  Queueable,
  RateLimited,
  ThrottlesExceptions,
  WithoutOverlapping,
  clearDispatcherContext,
  clearDriverContext,
  clearSyncHandlers,
  defineQueue,
  mq,
  type JobMiddleware,
} from "../src/mq";
import { clearMiddlewareState } from "../src/mq/middlewares/index";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq job middleware pipeline", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearDriverContext();
    clearSyncHandlers();
    clearMiddlewareState();
  });

  // ---------------------------------------------------------------------------
  // 1. Middleware runs in declared (onion) order
  // ---------------------------------------------------------------------------
  test("middleware runs in declared order — onion model", async () => {
    const Q = defineQueue({
      name: "mw-order",
      jobs: { work: {} as { id: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const log: string[] = [];

    function makeMw(label: string): JobMiddleware {
      return {
        async handle(_job, next) {
          log.push(`${label}-before`);
          const r = await next();
          log.push(`${label}-after`);
          return r;
        },
      };
    }

    @Queueable()
    class OrderJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "work";

      middleware() {
        return [makeMw("mw1"), makeMw("mw2"), makeMw("mw3")];
      }

      async handle(_payload: { id: string }) {
        log.push("handler");
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [OrderJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await OrderJob.dispatch({ id: "x" });
    await sleep(80);

    expect(log).toEqual([
      "mw1-before",
      "mw2-before",
      "mw3-before",
      "handler",
      "mw3-after",
      "mw2-after",
      "mw1-after",
    ]);
  });

  // ---------------------------------------------------------------------------
  // 2. Middleware that doesn't call next() skips the handler
  // ---------------------------------------------------------------------------
  test("middleware that omits next() skips the handler", async () => {
    const Q = defineQueue({
      name: "mw-skip",
      jobs: { work: {} as void },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    let handlerCalled = false;

    const blockingMw: JobMiddleware = {
      async handle(_job, _next) {
        // Deliberately does NOT call next().
        return undefined;
      },
    };

    @Queueable()
    class SkipJob extends Dispatchable<void> {
      static override queue = Q;
      static override jobName = "work";

      middleware() {
        return [blockingMw];
      }

      async handle() {
        handlerCalled = true;
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [SkipJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await SkipJob.dispatch();
    await sleep(60);

    expect(handlerCalled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 3. job.release() re-enqueues with delay, doesn't increment attempt count
  // ---------------------------------------------------------------------------
  test("job.release() re-enqueues the job without incrementing attemptsMade", async () => {
    const Q3 = defineQueue({
      name: "mw-release3",
      jobs: { task: {} as { id: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    // The middleware calls release exactly once. On the first run (runCount===0)
    // it records attemptsMade then releases. On the second run (runCount===1)
    // it records attemptsMade and lets it proceed. The release() call creates
    // a brand-new job, so attemptsMade on the second run is still 0.
    const attemptLog: number[] = [];
    let runCount = 0;

    const onceReleaseMw: JobMiddleware = {
      async handle(job, next) {
        attemptLog.push(job.attemptsMade);
        if (runCount === 0) {
          runCount++;
          job.release(0); // throws JobReleasedError — re-enqueues with 0 s delay
        }
        runCount++;
        return next();
      },
    };

    @Queueable()
    class ReleaseOnceJob extends Dispatchable<{ id: string }> {
      static override queue = Q3;
      static override jobName = "task";

      middleware() {
        return [onceReleaseMw];
      }

      async handle(_payload: { id: string }) {}
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q3] })],
      providers: [ReleaseOnceJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    await ReleaseOnceJob.dispatch({ id: "r1" });
    // Wait for first run + re-enqueue + second run
    await sleep(150);

    // Both runs should have attemptsMade === 0 because release() creates a
    // fresh job rather than retrying the same one.
    expect(attemptLog.length).toBeGreaterThanOrEqual(2);
    expect(attemptLog[0]).toBe(0); // first run of original job
    // The re-enqueued job is a fresh job, so its attemptsMade is also 0.
    expect(attemptLog[1]).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 4. RateLimited releases the 3rd job within the window
  // ---------------------------------------------------------------------------
  test("RateLimited releases the 3rd job when maxPerWindow=2", async () => {
    const Q = defineQueue({
      name: "mw-rate",
      jobs: { process: {} as { n: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const processed: number[] = [];

    @Queueable()
    class RateJob extends Dispatchable<{ n: number }> {
      static override queue = Q;
      static override jobName = "process";

      middleware() {
        // Very short window so the test doesn't need to wait long.
        return [new RateLimited("rate-test", 2, 5_000)];
      }

      async handle({ n }: { n: number }) {
        processed.push(n);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [RateJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Dispatch 3 jobs — only 2 should process in the first window.
    await RateJob.dispatch({ n: 1 });
    await RateJob.dispatch({ n: 2 });
    await RateJob.dispatch({ n: 3 });

    await sleep(150);

    // Job 3 was released (re-enqueued with delay), not processed yet.
    expect(processed.length).toBe(2);
    expect(processed).toContain(1);
    expect(processed).toContain(2);

    // Verify job 3 is in a delayed state (not completed/dropped).
    const rawQueue = ctx.get<any>(`Mq_${Q.name}`);
    const counts = await rawQueue.getJobCounts();
    expect((counts.delayed ?? 0) + (counts.waiting ?? 0)).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 5. WithoutOverlapping prevents concurrent runs for the same key
  // ---------------------------------------------------------------------------
  test("WithoutOverlapping ensures at most one concurrent execution for the same key", async () => {
    const Q = defineQueue({
      name: "mw-overlap",
      jobs: { task: {} as { seq: number } },
      // concurrency: 5 so multiple workers can try to pick up jobs simultaneously
      worker: { blockTimeout: 10, lockDuration: 500, concurrency: 5 },
    });

    let concurrentCount = 0;
    let maxConcurrent = 0;

    // Track how many jobs are running at once — the middleware should ensure
    // no two run concurrently for the same overlap key.
    const handles: Array<() => void> = [];
    const holdFor = (ms: number) =>
      new Promise<void>((resolve) => {
        handles.push(resolve);
        setTimeout(resolve, ms);
      });

    @Queueable()
    class OverlapJob extends Dispatchable<{ seq: number }> {
      static override queue = Q;
      static override jobName = "task";

      middleware() {
        return [new WithoutOverlapping("overlap-key-2", 10_000)];
      }

      async handle(_payload: { seq: number }) {
        concurrentCount++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCount);
        // Hold the job for a short time so other concurrent slots have a
        // chance to attempt acquisition while this one holds the lock.
        await holdFor(30);
        concurrentCount--;
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [OverlapJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Dispatch 5 jobs simultaneously; with concurrency=5 the worker can
    // run all at once — but WithoutOverlapping should serialize them.
    await Promise.all([
      OverlapJob.dispatch({ seq: 1 }),
      OverlapJob.dispatch({ seq: 2 }),
      OverlapJob.dispatch({ seq: 3 }),
      OverlapJob.dispatch({ seq: 4 }),
      OverlapJob.dispatch({ seq: 5 }),
    ]);

    // Wait long enough for at least one "wave" to complete. With 30ms per
    // job and at most 1 concurrent, ~150ms covers 5 sequential runs.
    // We only wait ~100ms so some jobs may still be pending/delayed.
    await sleep(250);

    // Core invariant: never more than 1 handler ran at the same time.
    expect(maxConcurrent).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 6. ThrottlesExceptions releases after failure threshold
  // ---------------------------------------------------------------------------
  test("ThrottlesExceptions releases jobs after maxFailures exceeded", async () => {
    const Q = defineQueue({
      name: "mw-throttle",
      jobs: { work: {} as { attempt: number } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const results: Array<"ran" | "released"> = [];
    let jobAttempts = 0;

    const trackRelease: JobMiddleware = {
      async handle(job, next) {
        // Wrap next() to detect release.
        try {
          return await next();
        } catch (err) {
          // If it's a JobReleasedError it propagates up to registry which
          // re-enqueues. We detect it here by checking type name.
          if ((err as Error).name === "JobReleasedError") {
            results.push("released");
          }
          throw err;
        }
      },
    };

    @Queueable()
    class ThrottleJob extends Dispatchable<{ attempt: number }> {
      static override queue = Q;
      static override jobName = "work";

      middleware() {
        // maxFailures=2, decayMs=10_000 (long enough not to reset in test)
        return [trackRelease, new ThrottlesExceptions(2, 10_000)];
      }

      async handle({ attempt }: { attempt: number }) {
        jobAttempts++;
        if (attempt < 3) {
          throw new Error(`simulated failure at attempt ${attempt}`);
        }
        results.push("ran");
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [ThrottleJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Dispatch 3 jobs that all fail — after 2 failures the 3rd should be released.
    // We use separate payloads but the same queue+jobName key for ThrottlesExceptions.
    await ThrottleJob.dispatch({ attempt: 1 }); // will fail, failure #1
    await ThrottleJob.dispatch({ attempt: 2 }); // will fail, failure #2
    await ThrottleJob.dispatch({ attempt: 3 }); // threshold reached → released

    await sleep(200);

    // The 3rd job should have been released, not run.
    expect(results).toContain("released");
    // Failures 1 & 2 ran through the handler.
    expect(jobAttempts).toBeGreaterThanOrEqual(2);

    const rawQueue = ctx.get<any>(`Mq_${Q.name}`);
    const counts = await rawQueue.getJobCounts();
    const delayedOrWaiting = (counts.delayed ?? 0) + (counts.waiting ?? 0);
    expect(delayedOrWaiting).toBeGreaterThanOrEqual(1);
  });
});
