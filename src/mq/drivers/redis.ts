import { EventEmitter } from "node:events";
import { createRedisClientAdapter } from "../adapters/redis-client";
import { MissingLockError } from "../errors";
import type {
  ClaimNextOptions,
  JobJson,
  JobsOptions,
  JobState,
  MqConnectionOptions,
  QueueDriver,
  QueueEvent,
  RedisClientAdapter,
} from "../types";

function normalizeOptions(options: JobsOptions): JobsOptions {
  return {
    attempts: options.attempts ?? 1,
    delay: options.delay ?? 0,
    removeOnComplete: options.removeOnComplete ?? false,
    removeOnFail: options.removeOnFail ?? false,
    backoff: options.backoff,
    jobId: options.jobId,
    // Chain side-channel fields — must be preserved so the worker can advance the chain.
    __chainId: options.__chainId,
    __chainStepIndex: options.__chainStepIndex,
    // Batch side-channel field — must be preserved so the barrier can count completions.
    __batchId: options.__batchId,
    lockKey: options.lockKey,
    lockUntilProcessing: options.lockUntilProcessing,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RedisQueueDriver implements QueueDriver {
  private readonly client: RedisClientAdapter;
  private readonly prefix: string;
  private readonly subscriptions = new Map<string, EventEmitter>();
  private readonly connection: MqConnectionOptions;
  private closed = false;

  constructor(connection: MqConnectionOptions = {}) {
    this.connection = connection;
    this.prefix = connection.prefix ?? "techne:mq";
    this.client = createRedisClientAdapter(connection, "client");
  }

  async add<T>(
    queueName: string,
    name: string,
    data: T,
    options: JobsOptions,
  ): Promise<JobJson<T>> {
    const normalized = normalizeOptions(options);
    const now = Date.now();
    const id = normalized.jobId ?? crypto.randomUUID();
    const paused = (await this.client.get(this.pausedKey(queueName))) === "1";
    const state: JobState =
      normalized.delay && normalized.delay > 0 ? "delayed" : paused ? "paused" : "waiting";

    const job: JobJson<T> = {
      id,
      name,
      data,
      queueName,
      opts: normalized,
      state,
      timestamp: now,
      attemptsMade: 0,
      progress: 0,
      delayUntil: normalized.delay && normalized.delay > 0 ? now + normalized.delay : undefined,
      stacktrace: [],
      stalledCount: 0,
    };

    await this.saveJob(queueName, job);
    await this.incrementState(queueName, state, 1);

    if (state === "delayed") {
      await this.client.zadd(this.delayedKey(queueName), job.delayUntil!, id);
    } else if (state === "paused") {
      await this.client.rpush(this.pausedListKey(queueName), id);
    } else {
      await this.client.rpush(this.waitKey(queueName), id);
      await this.publish(queueName, { event: "waiting", payload: { jobId: id } });
    }

    return job;
  }

  async addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; opts: JobsOptions }>,
  ): Promise<Array<JobJson<T>>> {
    const added: Array<JobJson<T>> = [];
    for (const job of jobs) {
      added.push(await this.add(queueName, job.name, job.data, job.opts));
    }
    return added;
  }

  async claimNext(queueName: string, options: ClaimNextOptions): Promise<JobJson | null> {
    const timeout = options.blockTimeout ?? 0;
    const deadline = Date.now() + timeout;

    while (!this.closed) {
      await this.promoteDelayed(queueName);

      if ((await this.client.get(this.pausedKey(queueName))) === "1") {
        if (Date.now() >= deadline) return null;
        await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
        continue;
      }

      const untilNextDelayed = await this.msUntilNextDelayed(queueName);
      const remaining = Math.max(0, deadline - Date.now());
      if (remaining <= 0) {
        return null;
      }

      const blockForMs =
        untilNextDelayed === null ? remaining : Math.max(1, Math.min(remaining, untilNextDelayed));
      const id = await this.client.blpop(
        this.waitKey(queueName),
        Math.max(1, Math.ceil(blockForMs / 1000)),
      );
      if (!id) {
        if (Date.now() >= deadline) {
          return null;
        }
        continue;
      }

      const job = await this.loadJob(queueName, id);
      if (!job) {
        continue;
      }

      await this.transitionState(queueName, job, "active");
      job.processedOn = Date.now();
      job.lockToken = options.lockToken;
      job.lockExpiresAt = Date.now() + options.lockDuration;
      await this.saveJob(queueName, job);
      await this.client.zadd(this.activeKey(queueName), job.lockExpiresAt, id);
      await this.publish(queueName, { event: "active", payload: { jobId: id } });
      return job;
    }

    return null;
  }

  async extendLock(
    queueName: string,
    jobId: string,
    lockToken: string,
    duration: number,
  ): Promise<boolean> {
    const job = await this.loadJob(queueName, jobId);
    if (!job || job.lockToken !== lockToken || job.state !== "active") return false;
    job.lockExpiresAt = Date.now() + duration;
    await this.saveJob(queueName, job);
    await this.client.zadd(this.activeKey(queueName), job.lockExpiresAt, jobId);
    return true;
  }

  async complete<R>(
    queueName: string,
    jobId: string,
    lockToken: string,
    returnValue?: R,
  ): Promise<void> {
    const job = await this.loadJob(queueName, jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);

    await this.client.zrem(this.activeKey(queueName), jobId);
    await this.transitionState(queueName, job, "completed");
    job.returnValue = returnValue;
    job.finishedOn = Date.now();
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;

    if (job.opts.removeOnComplete) {
      await this.deleteJob(queueName, jobId);
    } else {
      await this.saveJob(queueName, job);
    }

    await this.publish(queueName, {
      event: "completed",
      payload: { jobId, returnValue },
    });
  }

  async fail(
    queueName: string,
    jobId: string,
    lockToken: string,
    error: Error,
    retryAt?: number,
  ): Promise<void> {
    const job = await this.loadJob(queueName, jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);

    job.attemptsMade += 1;
    job.failedReason = error.message;
    job.stacktrace.push(error.stack ?? error.message);
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;
    await this.client.zrem(this.activeKey(queueName), jobId);

    if (retryAt && job.attemptsMade < (job.opts.attempts ?? 1)) {
      await this.transitionState(queueName, job, "delayed");
      job.delayUntil = retryAt;
      await this.saveJob(queueName, job);
      await this.client.zadd(this.delayedKey(queueName), retryAt, jobId);
      return;
    }

    await this.transitionState(queueName, job, "failed");
    job.finishedOn = Date.now();

    if (job.opts.removeOnFail) {
      await this.deleteJob(queueName, jobId);
    } else {
      await this.saveJob(queueName, job);
    }

    await this.publish(queueName, {
      event: "failed",
      payload: { jobId, failedReason: job.failedReason },
    });
  }

  async requeueStalled(queueName: string, maxStalledCount: number): Promise<string[]> {
    const now = Date.now();
    const ids = await this.client.zrangebyscore(this.activeKey(queueName), 0, now);
    const requeued: string[] = [];
    const paused = (await this.client.get(this.pausedKey(queueName))) === "1";

    for (const id of ids) {
      const job = await this.loadJob(queueName, id);
      if (!job || job.state !== "active" || !job.lockExpiresAt || job.lockExpiresAt > now) {
        continue;
      }

      await this.client.zrem(this.activeKey(queueName), id);
      job.lockToken = undefined;
      job.lockExpiresAt = undefined;
      job.stalledCount += 1;

      if (job.stalledCount > maxStalledCount) {
        await this.transitionState(queueName, job, "failed");
        job.failedReason = "job stalled more than allowable limit";
        job.finishedOn = now;
        await this.saveJob(queueName, job);
        await this.publish(queueName, {
          event: "failed",
          payload: { jobId: id, failedReason: job.failedReason },
        });
        continue;
      }

      await this.transitionState(queueName, job, paused ? "paused" : "waiting");
      await this.saveJob(queueName, job);
      if (paused) {
        await this.client.rpush(this.pausedListKey(queueName), id);
      } else {
        await this.client.rpush(this.waitKey(queueName), id);
      }
      requeued.push(id);
      await this.publish(queueName, { event: "stalled", payload: { jobId: id } });
    }

    return requeued;
  }

  async updateProgress(queueName: string, jobId: string, progress: number | object): Promise<void> {
    const job = await this.loadJob(queueName, jobId);
    if (!job) return;
    job.progress = progress;
    await this.saveJob(queueName, job);
    await this.publish(queueName, { event: "progress", payload: { jobId, data: progress } });
  }

  async getJob<T = unknown, R = unknown>(
    queueName: string,
    jobId: string,
  ): Promise<JobJson<T, R> | null> {
    return (await this.loadJob(queueName, jobId)) as JobJson<T, R> | null;
  }

  async getJobCounts(
    queueName: string,
    states?: JobState[],
  ): Promise<Partial<Record<JobState, number>>> {
    const requested = states ?? ["waiting", "active", "completed", "failed", "delayed", "paused"];
    const counts: Partial<Record<JobState, number>> = {};

    for (const state of requested) {
      const stored = await this.client.get(this.countKey(queueName, state));
      counts[state] = stored ? Number(stored) : 0;
    }

    return counts;
  }

  async pause(queueName: string): Promise<void> {
    await this.client.set(this.pausedKey(queueName), "1");
  }

  async resume(queueName: string): Promise<void> {
    await this.client.del(this.pausedKey(queueName));

    while (true) {
      const id = await this.client.lpop(this.pausedListKey(queueName));
      if (!id) break;

      const job = await this.loadJob(queueName, id);
      if (!job || job.state !== "paused") continue;

      await this.transitionState(queueName, job, "waiting");
      await this.saveJob(queueName, job);
      await this.client.rpush(this.waitKey(queueName), id);
      await this.publish(queueName, { event: "waiting", payload: { jobId: id } });
    }
  }

  async acquireUniqueLock(lockKey: string, ttlMs: number): Promise<boolean> {
    return this.client.setnx(`${this.prefix}:unique:${lockKey}`, "1", ttlMs);
  }

  async releaseUniqueLock(lockKey: string): Promise<void> {
    await this.client.del(`${this.prefix}:unique:${lockKey}`);
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.client.quit();
  }

  async subscribe(
    queueName: string,
    listener: (event: QueueEvent) => void,
  ): Promise<() => Promise<void> | void> {
    const subscriber = createRedisClientAdapter(
      {
        ...this.connection,
        driver: "redis",
        prefix: this.prefix,
      },
      "subscriber",
    );

    return await subscriber.subscribe(this.eventChannel(queueName), (message) => {
      listener(JSON.parse(message) as QueueEvent);
    });
  }

  private async loadJob(queueName: string, jobId: string): Promise<JobJson | null> {
    const raw = await this.client.get(this.jobKey(queueName, jobId));
    return raw ? (JSON.parse(raw) as JobJson) : null;
  }

  private async saveJob(queueName: string, job: JobJson): Promise<void> {
    await this.client.set(this.jobKey(queueName, job.id), JSON.stringify(job));
  }

  private async deleteJob(queueName: string, jobId: string): Promise<void> {
    await this.client.del(this.jobKey(queueName, jobId));
  }

  private async publish(queueName: string, event: QueueEvent): Promise<void> {
    await this.client.publish(this.eventChannel(queueName), JSON.stringify(event));
  }

  private async incrementState(queueName: string, state: JobState, delta: number): Promise<void> {
    const key = this.countKey(queueName, state);
    const current = Number((await this.client.get(key)) ?? "0");
    await this.client.set(key, String(Math.max(0, current + delta)));
  }

  private async transitionState(queueName: string, job: JobJson, next: JobState): Promise<void> {
    if (job.state === next) return;
    await this.incrementState(queueName, job.state, -1);
    job.state = next;
    await this.incrementState(queueName, next, 1);
  }

  private async promoteDelayed(queueName: string): Promise<void> {
    const now = Date.now();
    const paused = (await this.client.get(this.pausedKey(queueName))) === "1";
    const ids = await this.client.zrangebyscore(this.delayedKey(queueName), 0, now);

    for (const id of ids) {
      const job = await this.loadJob(queueName, id);
      if (!job || job.state !== "delayed") continue;

      await this.client.zrem(this.delayedKey(queueName), id);
      await this.transitionState(queueName, job, paused ? "paused" : "waiting");
      job.delayUntil = undefined;
      await this.saveJob(queueName, job);

      if (paused) {
        await this.client.rpush(this.pausedListKey(queueName), id);
      } else {
        await this.client.rpush(this.waitKey(queueName), id);
        await this.publish(queueName, { event: "waiting", payload: { jobId: id } });
      }
    }
  }

  private async msUntilNextDelayed(queueName: string): Promise<number | null> {
    const next = await this.client.zrange(this.delayedKey(queueName), 0, 0, true);
    if (next.length < 2) return null;
    const score = Number(next[1]);
    if (Number.isNaN(score)) return null;
    return Math.max(0, score - Date.now());
  }

  private waitKey(queueName: string): string {
    return `${this.prefix}:${queueName}:wait`;
  }

  private pausedListKey(queueName: string): string {
    return `${this.prefix}:${queueName}:paused`;
  }

  private delayedKey(queueName: string): string {
    return `${this.prefix}:${queueName}:delayed`;
  }

  private activeKey(queueName: string): string {
    return `${this.prefix}:${queueName}:active`;
  }

  private jobKey(queueName: string, jobId: string): string {
    return `${this.prefix}:${queueName}:job:${jobId}`;
  }

  private pausedKey(queueName: string): string {
    return `${this.prefix}:${queueName}:meta:paused`;
  }

  private countKey(queueName: string, state: JobState): string {
    return `${this.prefix}:${queueName}:counts:${state}`;
  }

  private eventChannel(queueName: string): string {
    return `${this.prefix}:${queueName}:events`;
  }
}
