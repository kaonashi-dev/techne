import { afterEach, describe, expect, test } from "bun:test";
import { Queue } from "../src/mq/queue";
import { Worker } from "../src/mq/worker";
import { Job } from "../src/mq/job";
import { MemoryQueueDriver } from "../src/mq/drivers/memory";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Direct unit tests for the in-memory `Worker`/`Queue`/`Job` triple. These do
 * NOT exercise `@MqProcessor`/`@MqProcess` discovery or the `TechneFactory`
 * boot path — both are covered by `tests/queue.test.ts`. The focus here is
 * the worker's internal lifecycle: backoff math, retry boundary, concurrency
 * cap, graceful shutdown, and the `Job.toJSON()` snapshot shape.
 */
describe("Worker / Queue / Job (unit, memory driver)", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });

  test("exponential backoff grows each retry (delayUntil doubles)", async () => {
    // Use a shared driver so the worker and the assertions can observe the
    // same job state across attempts.
    const driver = new MemoryQueueDriver();
    const queue = new Queue("backoff", {}, driver);
    closers.push(() => queue.close());

    const attemptTimestamps: number[] = [];
    const worker = new Worker(
      queue,
      async () => {
        attemptTimestamps.push(Date.now());
        throw new Error("always fail");
      },
      {
        blockTimeout: 5,
        lockDuration: 500,
        // stalledInterval is internal noise for this assertion; push it out.
        stalledInterval: 60_000,
      },
    );
    closers.push(() => worker.close());

    // attempts: 4 => up to 3 retries; backoff: exponential delay=20
    // Expected gaps between successive attempts: ~20ms, ~40ms, ~80ms
    const job = await queue.add(
      "task",
      { n: 1 },
      { attempts: 4, backoff: { type: "exponential", delay: 20 } },
    );

    // Wait long enough for all retries to elapse (20+40+80 = 140ms) plus
    // the worker's blockTimeout polling jitter.
    await sleep(400);
    await worker.close();

    expect(attemptTimestamps.length).toBe(4);
    const gap1 = attemptTimestamps[1]! - attemptTimestamps[0]!;
    const gap2 = attemptTimestamps[2]! - attemptTimestamps[1]!;
    const gap3 = attemptTimestamps[3]! - attemptTimestamps[2]!;
    // Each successive gap should be roughly double the previous. Allow a
    // generous lower bound (driver/scheduler jitter on shared CI hosts).
    expect(gap1).toBeGreaterThanOrEqual(15);
    expect(gap2).toBeGreaterThan(gap1);
    expect(gap3).toBeGreaterThan(gap2);

    // Final job state should be `failed` after attempts exhausted.
    const finalJob = await driver.getJob("backoff", job.id);
    expect(finalJob?.state).toBe("failed");
    expect(finalJob?.attemptsMade).toBe(4);
  });

  test("retry boundary: stops retrying after `attempts` failures", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("retry-boundary", {}, driver);
    closers.push(() => queue.close());

    let invocations = 0;
    const worker = new Worker(
      queue,
      async () => {
        invocations++;
        throw new Error("boom");
      },
      {
        blockTimeout: 5,
        lockDuration: 500,
        stalledInterval: 60_000,
      },
    );
    closers.push(() => worker.close());

    const job = await queue.add(
      "task",
      { n: 1 },
      { attempts: 3, backoff: { type: "fixed", delay: 5 } },
    );

    await sleep(120);
    await worker.close();

    // Exactly 3 invocations (initial + 2 retries), never a 4th.
    expect(invocations).toBe(3);
    const stored = await driver.getJob("retry-boundary", job.id);
    expect(stored?.state).toBe("failed");
    expect(stored?.attemptsMade).toBe(3);
    expect(stored?.failedReason).toBe("boom");
  });

  test("concurrency: caps the number of jobs in flight", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("concurrent", {}, driver);
    closers.push(() => queue.close());

    let inFlight = 0;
    let peakInFlight = 0;
    const releases: Array<() => void> = [];

    const worker = new Worker(
      queue,
      async () => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        // Block until the test releases this job.
        await new Promise<void>((resolve) => {
          releases.push(() => {
            inFlight -= 1;
            resolve();
          });
        });
      },
      {
        concurrency: 2,
        blockTimeout: 5,
        lockDuration: 1_000,
        stalledInterval: 60_000,
      },
    );
    closers.push(() => worker.close());

    // Enqueue 5 jobs; only 2 should run at a time.
    for (let i = 0; i < 5; i++) {
      await queue.add("task", { i });
    }

    // Give the runner loops a chance to claim jobs.
    await sleep(60);
    expect(inFlight).toBe(2);
    expect(peakInFlight).toBe(2);

    // Release jobs one by one, draining the queue. The peak must stay at 2.
    while (releases.length > 0) {
      releases.shift()!();
      await sleep(30);
    }

    expect(peakInFlight).toBe(2);
  });

  test("close() waits for in-flight jobs to finish before resolving", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("graceful", {}, driver);
    closers.push(() => queue.close());

    let finished = false;
    let release: (() => void) | undefined;
    const worker = new Worker(
      queue,
      async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        finished = true;
      },
      {
        blockTimeout: 5,
        lockDuration: 1_000,
        stalledInterval: 60_000,
      },
    );

    await queue.add("task", { n: 1 });
    // Wait for the worker to pick up the job.
    await sleep(40);
    expect(release).toBeDefined();
    expect(finished).toBe(false);

    // Kick off close() — it should NOT resolve until we release the in-flight
    // processor (close awaits Promise.allSettled(runners)).
    const closing = worker.close();
    await sleep(20);
    expect(finished).toBe(false);

    release!();
    await closing;
    expect(finished).toBe(true);
  });

  test("Job.toJSON() exposes the expected snapshot keys", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("snapshot", {}, driver);
    closers.push(() => queue.close());

    const job = await queue.add("task", { hello: "world" }, { attempts: 2 });
    const snapshot = job.toJSON();

    // Spot-check every key the rest of the framework relies on. Using a
    // checklist rather than `toEqual` keeps the test resilient to future
    // additions on JobJson.
    const requiredKeys = [
      "id",
      "name",
      "data",
      "queueName",
      "opts",
      "state",
      "timestamp",
      "attemptsMade",
      "progress",
      "stacktrace",
      "stalledCount",
    ] as const;
    for (const key of requiredKeys) {
      expect(snapshot).toHaveProperty(key);
    }
    expect(snapshot.id).toBe(job.id);
    expect(snapshot.name).toBe("task");
    expect(snapshot.data).toEqual({ hello: "world" });
    expect(snapshot.queueName).toBe("snapshot");
    expect(snapshot.opts.attempts).toBe(2);
    expect(snapshot.state).toBe("waiting");
    expect(snapshot.attemptsMade).toBe(0);
    expect(snapshot.stacktrace).toEqual([]);
    expect(snapshot.stalledCount).toBe(0);
  });

  test("Job snapshot reflects live progress/returnValue mutations", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("snapshot-mut", {}, driver);
    closers.push(() => queue.close());

    const job = await queue.add("task", { x: 1 });
    await job.updateProgress(42);
    job.returnValue = { ok: true } as any;

    const snapshot = job.toJSON();
    expect(snapshot.progress).toBe(42);
    expect(snapshot.returnValue).toEqual({ ok: true });
  });

  test("Job.fromJson() reconstructs an instance equivalent to the original", async () => {
    const driver = new MemoryQueueDriver();
    const queue = new Queue("rehydrate", {}, driver);
    closers.push(() => queue.close());

    const original = await queue.add("task", { x: 1 });
    const raw = original.toJSON();
    const rehydrated = Job.fromJson(driver, raw);

    expect(rehydrated).toBeInstanceOf(Job);
    expect(rehydrated.id).toBe(original.id);
    expect(rehydrated.name).toBe(original.name);
    expect(rehydrated.data).toEqual(original.data);
    expect(rehydrated.queueName).toBe(original.queueName);
  });
});
