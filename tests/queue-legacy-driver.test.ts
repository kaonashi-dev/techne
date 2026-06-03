import { afterEach, describe, expect, test } from "bun:test";
import type { EventEmitter } from "node:events";
import { MemoryQueueDriver } from "../src/queue/drivers/memory";
import { RedisQueueDriver } from "../src/queue/drivers/redis";
import { createQueueDriver } from "../src/queue/driver";
import { Queue } from "../src/queue/queue";
import { Job } from "../src/queue/job";
import { MissingLockError } from "../src/queue/errors";
import { getQueueToken } from "../src/queue/tokens";
import { queue as queuePlugin } from "../src/queue";
import { TechneFactory } from "../src/factory/techne-factory";

/**
 * Direct unit tests for the *legacy* `src/queue` module. This is a separate
 * implementation from `src/mq` (the legacy `Queue`/`Worker` classes are not
 * re-exported through the `./queue` subpath — that subpath forwards to `mq`).
 * The pieces still reachable in production are exercised here:
 *
 *   - `MemoryQueueDriver`  — default driver returned by `createQueueDriver()`
 *   - `Queue` (legacy)     — used by the `queue()` plugin
 *   - `Job` (legacy)       — produced by `Queue.add`
 *   - `createQueueDriver`  — memory/redis selection
 *   - `queue()` plugin     — `TechneFactory` registration
 *
 * NOTE: `getQueueEventBus` is a process-global keyed by queue name, so every
 * test uses a unique queue name (`uniqueName`) to stay isolated. Listeners are
 * detached in `afterEach`.
 */

let counter = 0;
const uniqueName = (prefix: string) => `${prefix}-${counter++}-${crypto.randomUUID().slice(0, 8)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const noopOpts = {};

describe("MemoryQueueDriver", () => {
  const busesToClean: EventEmitter[] = [];
  afterEach(() => {
    for (const bus of busesToClean.splice(0)) bus.removeAllListeners();
  });

  /** Attach a recorder to a queue's global event bus and track for cleanup. */
  function recordEvents(driver: MemoryQueueDriver, queueName: string) {
    const bus = driver.getEventBus(queueName);
    busesToClean.push(bus);
    const events: Array<{ event: string; payload: any }> = [];
    for (const event of ["waiting", "active", "completed", "failed", "progress", "stalled"]) {
      bus.on(event, (payload) => events.push({ event, payload }));
    }
    return events;
  }

  test("add() enqueues a waiting job and emits 'waiting'", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("add");
    const events = recordEvents(driver, name);

    const job = await driver.add(name, "task", { n: 1 }, noopOpts);

    expect(job.state).toBe("waiting");
    expect(job.id).toBeString();
    expect(job.data).toEqual({ n: 1 });
    expect(job.attemptsMade).toBe(0);
    expect(await driver.count(name)).toBe(1);
    expect(events.map((e) => e.event)).toEqual(["waiting"]);
    expect(events[0]!.payload).toEqual({ jobId: job.id });
  });

  test("add() honours a provided jobId and normalises options", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("jobid");

    const job = await driver.add(name, "task", { n: 1 }, { jobId: "fixed-id" });

    expect(job.id).toBe("fixed-id");
    // normalizeOptions fills defaults
    expect(job.opts.attempts).toBe(1);
    expect(job.opts.delay).toBe(0);
    expect(job.opts.removeOnComplete).toBe(false);
    expect(job.opts.removeOnFail).toBe(false);
  });

  test("add() with a delay places the job in the delayed set (not waiting)", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("delay");
    const events = recordEvents(driver, name);

    const job = await driver.add(name, "task", { n: 1 }, { delay: 10_000 });

    expect(job.state).toBe("delayed");
    expect(job.delayUntil).toBeGreaterThan(Date.now());
    // Delayed jobs are not immediately fetchable...
    expect(await driver.getNextJob(name, "lock", 1000)).toBeNull();
    // ...but they still count.
    expect(await driver.count(name)).toBe(1);
    // No 'waiting' event for a delayed enqueue.
    expect(events.map((e) => e.event)).toEqual([]);
  });

  test("add() while paused marks the job 'paused' and suppresses 'waiting'", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("paused-add");
    await driver.pause(name);
    const events = recordEvents(driver, name);

    const job = await driver.add(name, "task", { n: 1 }, noopOpts);

    expect(job.state).toBe("paused");
    expect(events).toEqual([]);
    // Paused queue yields nothing.
    expect(await driver.getNextJob(name, "lock", 1000)).toBeNull();
  });

  test("addBulk() enqueues every job", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("bulk");

    const created = await driver.addBulk(name, [
      { name: "a", data: { i: 0 }, options: noopOpts },
      { name: "b", data: { i: 1 }, options: noopOpts },
      { name: "c", data: { i: 2 }, options: noopOpts },
    ]);

    expect(created).toHaveLength(3);
    expect(created.map((j) => j.name)).toEqual(["a", "b", "c"]);
    expect(await driver.count(name)).toBe(3);
  });

  test("getNextJob() activates the job, sets the lock, and emits 'active'", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("next");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", { n: 1 }, noopOpts);

    const claimed = await driver.getNextJob(name, "lock-token", 5_000);

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(added.id);
    expect(claimed!.state).toBe("active");
    expect(claimed!.lockToken).toBe("lock-token");
    expect(claimed!.lockExpiresAt).toBeGreaterThan(Date.now());
    expect(claimed!.processedOn).toBeNumber();
    expect(events.map((e) => e.event)).toEqual(["waiting", "active"]);
    // It was removed from the waiting set.
    expect(await driver.getNextJob(name, "another", 5_000)).toBeNull();
  });

  test("getNextJob() returns null on an empty queue", async () => {
    const driver = new MemoryQueueDriver();
    expect(await driver.getNextJob(uniqueName("empty"), "lock", 1000)).toBeNull();
  });

  test("extendLock() succeeds with the right token and fails otherwise", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("extend");
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 5_000);

    expect(await driver.extendLock(name, added.id, "tok", 10_000)).toBe(true);
    // Wrong token.
    expect(await driver.extendLock(name, added.id, "wrong", 10_000)).toBe(false);
    // Unknown job.
    expect(await driver.extendLock(name, "nope", "tok", 10_000)).toBe(false);
  });

  test("extendLock() fails once the job is no longer active", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("extend-inactive");
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 5_000);
    await driver.complete(name, added.id, "tok");

    expect(await driver.extendLock(name, added.id, "tok", 10_000)).toBe(false);
  });

  test("complete() marks the job completed and emits the return value", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("complete");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 5_000);

    await driver.complete(name, added.id, "tok", { ok: true });

    const stored = await driver.getJob(name, added.id);
    expect(stored!.state).toBe("completed");
    expect(stored!.returnValue).toEqual({ ok: true });
    expect(stored!.finishedOn).toBeNumber();
    expect(stored!.lockToken).toBeUndefined();
    const completed = events.find((e) => e.event === "completed");
    expect(completed!.payload).toEqual({ jobId: added.id, returnValue: { ok: true } });
  });

  test("complete() with removeOnComplete deletes the job", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("complete-remove");
    const added = await driver.add(name, "task", {}, { removeOnComplete: true });
    await driver.getNextJob(name, "tok", 5_000);

    await driver.complete(name, added.id, "tok");

    expect(await driver.getJob(name, added.id)).toBeNull();
  });

  test("complete() with a stale lock token throws MissingLockError", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("complete-stale");
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 5_000);

    await expect(driver.complete(name, added.id, "wrong")).rejects.toThrow(MissingLockError);
  });

  test("fail() (terminal) marks the job failed and records the reason/stacktrace", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("fail");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, { attempts: 1 });
    await driver.getNextJob(name, "tok", 5_000);

    await driver.fail(name, added.id, "tok", new Error("boom"));

    const stored = await driver.getJob(name, added.id);
    expect(stored!.state).toBe("failed");
    expect(stored!.attemptsMade).toBe(1);
    expect(stored!.failedReason).toBe("boom");
    expect(stored!.stacktrace).toHaveLength(1);
    expect(events.find((e) => e.event === "failed")!.payload).toEqual({
      jobId: added.id,
      failedReason: "boom",
    });
  });

  test("fail() with a retryAt and remaining attempts re-delays the job", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("fail-retry");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, { attempts: 3 });
    await driver.getNextJob(name, "tok", 5_000);

    await driver.fail(name, added.id, "tok", new Error("again"), Date.now() + 10_000);

    const stored = await driver.getJob(name, added.id);
    expect(stored!.state).toBe("delayed");
    expect(stored!.attemptsMade).toBe(1);
    expect(stored!.delayUntil).toBeGreaterThan(Date.now());
    // Re-delay emits 'waiting' (re-queued), not 'failed'.
    expect(events.some((e) => e.event === "waiting")).toBe(true);
    expect(events.some((e) => e.event === "failed")).toBe(false);
  });

  test("fail() with removeOnFail deletes the job on terminal failure", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("fail-remove");
    const added = await driver.add(name, "task", {}, { attempts: 1, removeOnFail: true });
    await driver.getNextJob(name, "tok", 5_000);

    await driver.fail(name, added.id, "tok", new Error("boom"));

    expect(await driver.getJob(name, added.id)).toBeNull();
  });

  test("fail() with a stale lock token throws MissingLockError", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("fail-stale");
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 5_000);

    await expect(driver.fail(name, added.id, "wrong", new Error("x"))).rejects.toThrow(
      MissingLockError,
    );
  });

  test("requeueStalled() re-queues an active job whose lock has expired", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("stalled");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, noopOpts);
    // Negative lock duration => lock is already expired.
    await driver.getNextJob(name, "tok", -1);

    const requeued = await driver.requeueStalled(name, 1);

    expect(requeued).toEqual([added.id]);
    const stored = await driver.getJob(name, added.id);
    expect(stored!.state).toBe("waiting");
    expect(stored!.stalledCount).toBe(1);
    expect(stored!.lockToken).toBeUndefined();
    expect(events.some((e) => e.event === "stalled")).toBe(true);
    // The re-queued job is fetchable again.
    expect(await driver.getNextJob(name, "tok2", 5_000)).not.toBeNull();
  });

  test("requeueStalled() fails a job that exceeds maxStalledCount", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("stalled-limit");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", -1);

    const requeued = await driver.requeueStalled(name, 0);

    expect(requeued).toEqual([]);
    const stored = await driver.getJob(name, added.id);
    expect(stored!.state).toBe("failed");
    expect(stored!.failedReason).toBe("job stalled more than allowable limit");
    expect(events.some((e) => e.event === "failed")).toBe(true);
  });

  test("requeueStalled() ignores jobs whose lock is still valid", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("stalled-valid");
    await driver.add(name, "task", {}, noopOpts);
    await driver.getNextJob(name, "tok", 60_000);

    expect(await driver.requeueStalled(name, 1)).toEqual([]);
  });

  test("updateProgress() stores progress and emits 'progress'", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("progress");
    const events = recordEvents(driver, name);
    const added = await driver.add(name, "task", {}, noopOpts);

    await driver.updateProgress(name, added.id, 75);
    expect((await driver.getJob(name, added.id))!.progress).toBe(75);

    await driver.updateProgress(name, added.id, { pct: 50 });
    expect((await driver.getJob(name, added.id))!.progress).toEqual({ pct: 50 });

    expect(events.filter((e) => e.event === "progress")).toHaveLength(2);
  });

  test("updateProgress() is a no-op for an unknown job", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("progress-missing");
    await driver.updateProgress(name, "nope", 10); // must not throw
    expect(await driver.getJob(name, "nope")).toBeNull();
  });

  test("getJob() returns a deep clone, not a live reference", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("clone");
    const added = await driver.add(name, "task", { nested: { v: 1 } }, noopOpts);

    const first = await driver.getJob<{ nested: { v: number } }>(name, added.id);
    first!.data.nested.v = 999;

    const second = await driver.getJob<{ nested: { v: number } }>(name, added.id);
    expect(second!.data.nested.v).toBe(1);
  });

  test("getJob() returns null for an unknown id", async () => {
    const driver = new MemoryQueueDriver();
    expect(await driver.getJob(uniqueName("nojob"), "missing")).toBeNull();
  });

  test("count() sums waiting and delayed jobs", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("count");
    await driver.add(name, "a", {}, noopOpts);
    await driver.add(name, "b", {}, { delay: 10_000 });

    expect(await driver.count(name)).toBe(2);
  });

  test("pause()/resume() gate job delivery", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("pause-resume");
    await driver.add(name, "task", {}, noopOpts);

    await driver.pause(name);
    expect(await driver.getNextJob(name, "tok", 5_000)).toBeNull();

    await driver.resume(name);
    expect(await driver.getNextJob(name, "tok", 5_000)).not.toBeNull();
  });

  test("delayed jobs are promoted to waiting once their delay elapses", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("promote");
    await driver.add(name, "task", {}, { delay: 20 });

    // Still delayed immediately.
    expect(await driver.getNextJob(name, "tok", 5_000)).toBeNull();

    await sleep(35);

    // Promoted on the next access.
    expect(await driver.getNextJob(name, "tok", 5_000)).not.toBeNull();
  });

  test("close() resolves without error", async () => {
    await expect(new MemoryQueueDriver().close()).resolves.toBeUndefined();
  });
});

describe("createQueueDriver", () => {
  test("defaults to the in-memory driver", () => {
    expect(createQueueDriver()).toBeInstanceOf(MemoryQueueDriver);
    expect(createQueueDriver({})).toBeInstanceOf(MemoryQueueDriver);
    expect(createQueueDriver({ driver: "memory" })).toBeInstanceOf(MemoryQueueDriver);
  });

  test("returns a Redis driver when driver: 'redis' (with an injected client)", () => {
    // Injecting a client avoids touching a real Redis server.
    const driver = createQueueDriver({ driver: "redis", client: {} });
    expect(driver).toBeInstanceOf(RedisQueueDriver);
  });
});

describe("Queue (legacy)", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((c) => c()));
  });

  test("constructs its own memory driver when none is injected", () => {
    const q = new Queue(uniqueName("auto-driver"));
    closers.push(() => q.close());
    expect(q.driver).toBeInstanceOf(MemoryQueueDriver);
  });

  test("add() wraps the driver result in a Job", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(uniqueName("wrap"), {}, driver);
    closers.push(() => q.close());

    const job = await q.add("send", { to: "x" });

    expect(job).toBeInstanceOf(Job);
    expect(job.name).toBe("send");
    expect(job.data).toEqual({ to: "x" });
    expect(await q.count()).toBe(1);
  });

  test("add() merges defaultJobOptions with per-call options", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(
      uniqueName("merge"),
      { defaultJobOptions: { attempts: 5, removeOnComplete: true } },
      driver,
    );
    closers.push(() => q.close());

    // Per-call option overrides the default; unspecified default carries through.
    const job = await q.add("send", {}, { attempts: 2 });

    expect(job.opts.attempts).toBe(2);
    expect(job.opts.removeOnComplete).toBe(true);
  });

  test("addBulk() returns a Job per entry", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(uniqueName("bulk"), {}, driver);
    closers.push(() => q.close());

    const jobs = await q.addBulk([
      { name: "a", data: { i: 0 } },
      { name: "b", data: { i: 1 }, options: { attempts: 3 } },
    ]);

    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j instanceof Job)).toBe(true);
    expect(jobs[1]!.opts.attempts).toBe(3);
  });

  test("getJob() returns a Job for a known id and null otherwise", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(uniqueName("get"), {}, driver);
    closers.push(() => q.close());

    const added = await q.add("send", {});
    const fetched = await q.getJob(added.id);
    expect(fetched).toBeInstanceOf(Job);
    expect(fetched!.id).toBe(added.id);

    expect(await q.getJob("missing")).toBeNull();
  });

  test("pause()/resume() and count() delegate to the driver", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(uniqueName("pause"), {}, driver);
    closers.push(() => q.close());

    await q.add("a", {});
    expect(await q.count()).toBe(1);
    await q.pause();
    await q.resume(); // exercises both delegations
    expect(await q.count()).toBe(1);
  });

  test("createJobFromRaw() rehydrates a Job from a raw record", async () => {
    const driver = new MemoryQueueDriver();
    const q = new Queue(uniqueName("raw"), {}, driver);
    closers.push(() => q.close());

    const added = await q.add("send", { a: 1 });
    const raw = await driver.getJob(q.name, added.id);
    const job = q.createJobFromRaw(raw!);

    expect(job).toBeInstanceOf(Job);
    expect(job.id).toBe(added.id);
  });
});

describe("Job (legacy)", () => {
  test("fromJson() reconstructs a Job and toJSON() reflects live mutations", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("job-json");
    const raw = await driver.add(name, "task", { hello: "world" }, { attempts: 2 });

    const job = Job.fromJson(driver, raw);
    expect(job).toBeInstanceOf(Job);
    expect(job.id).toBe(raw.id);
    expect(job.name).toBe("task");
    expect(job.data).toEqual({ hello: "world" });
    expect(job.opts.attempts).toBe(2);

    job.returnValue = { ok: true } as any;
    const snapshot = job.toJSON();
    expect(snapshot.returnValue).toEqual({ ok: true });
    expect(snapshot.id).toBe(raw.id);
  });

  test("updateProgress() updates the instance and persists through the driver", async () => {
    const driver = new MemoryQueueDriver();
    const name = uniqueName("job-progress");
    const raw = await driver.add(name, "task", {}, noopOpts);
    const job = Job.fromJson(driver, raw);

    await job.updateProgress(42);

    expect(job.progress).toBe(42);
    expect((await driver.getJob(name, raw.id))!.progress).toBe(42);
    expect(job.toJSON().progress).toBe(42);
  });
});

describe("MissingLockError", () => {
  test("carries the job id in its message", () => {
    const err = new MissingLockError("job-123");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Missing lock for job job-123");
  });
});

describe("queue() plugin", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((c) => c()));
  });

  test("registers Queue instances resolvable by their queue token", async () => {
    const name = uniqueName("emails");
    const moduleRef = await TechneFactory.createApplicationContext({
      plugins: [queuePlugin({ queues: [{ name }] })],
      logger: false,
    });
    closers.push(() => moduleRef.close());

    const resolved = moduleRef.get<Queue>(getQueueToken(name));
    expect(resolved).toBeInstanceOf(Queue);
    expect(resolved.name).toBe(name);

    // The plugin-provisioned queue is fully functional.
    const job = await resolved.add("welcome", { email: "dev@example.com" });
    expect(job).toBeInstanceOf(Job);
    expect(await resolved.count()).toBe(1);
  });
});
