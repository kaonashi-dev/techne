import type { EventEmitter } from "node:events";
import type { JobJson, JobsOptions, QueueConnectionOptions, QueueDriver } from "../types";
import { getQueueEventBus } from "../event-bus";
import { MissingLockError } from "../errors";

function normalizeOptions(options: JobsOptions): JobsOptions {
  return {
    attempts: options.attempts ?? 1,
    delay: options.delay ?? 0,
    removeOnComplete: options.removeOnComplete ?? false,
    removeOnFail: options.removeOnFail ?? false,
    backoff: options.backoff,
    jobId: options.jobId,
  };
}

export class RedisQueueDriver implements QueueDriver {
  private client: any;
  private prefix: string;

  constructor(connection: QueueConnectionOptions = {}) {
    this.prefix = connection.prefix ?? "bnest:queue";
    this.client =
      connection.client ??
      connection.clientFactory?.() ??
      (Bun as any).redis?.(connection.url || "redis://127.0.0.1:6379");
    if (!this.client) {
      throw new Error("Redis client is not available in this Bun runtime");
    }
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
    const job: JobJson<T> = {
      id,
      name,
      data,
      queueName,
      opts: normalized,
      state: normalized.delay && normalized.delay > 0 ? "delayed" : "waiting",
      timestamp: now,
      attemptsMade: 0,
      progress: 0,
      delayUntil: normalized.delay && normalized.delay > 0 ? now + normalized.delay : undefined,
      stacktrace: [],
      stalledCount: 0,
    };

    await this.client.set(this.jobKey(queueName, id), JSON.stringify(job));
    if (job.state === "delayed") {
      await this.client.zadd(this.delayedKey(queueName), job.delayUntil, id);
    } else {
      await this.client.rpush(this.waitKey(queueName), id);
      this.getEventBus(queueName).emit("waiting", { jobId: id });
    }
    return job;
  }

  async addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options: JobsOptions }>,
  ): Promise<Array<JobJson<T>>> {
    const created: Array<JobJson<T>> = [];
    for (const job of jobs) {
      created.push(await this.add(queueName, job.name, job.data, job.options));
    }
    return created;
  }

  async getNextJob(
    queueName: string,
    lockToken: string,
    lockDuration: number,
  ): Promise<JobJson | null> {
    await this.promoteDelayed(queueName);
    const paused = await this.client.get(this.pausedKey(queueName));
    if (paused === "1") return null;

    const id = await this.client.lpop(this.waitKey(queueName));
    if (!id) return null;

    const job = await this.loadJob(queueName, id);
    if (!job) return null;

    const now = Date.now();
    job.state = "active";
    job.processedOn = now;
    job.lockToken = lockToken;
    job.lockExpiresAt = now + lockDuration;
    await this.saveJob(queueName, job);
    await this.client.zadd(this.activeKey(queueName), job.lockExpiresAt, id);
    this.getEventBus(queueName).emit("active", { jobId: id });
    return job;
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
    job.state = "completed";
    job.returnValue = returnValue;
    job.finishedOn = Date.now();
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;
    await this.client.zrem(this.activeKey(queueName), jobId);
    if (job.opts.removeOnComplete) {
      await this.client.del(this.jobKey(queueName, jobId));
    } else {
      await this.saveJob(queueName, job);
    }
    this.getEventBus(queueName).emit("completed", { jobId, returnValue });
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
      job.state = "delayed";
      job.delayUntil = retryAt;
      await this.saveJob(queueName, job);
      await this.client.zadd(this.delayedKey(queueName), retryAt, jobId);
      this.getEventBus(queueName).emit("waiting", { jobId });
      return;
    }

    job.state = "failed";
    job.finishedOn = Date.now();
    if (job.opts.removeOnFail) {
      await this.client.del(this.jobKey(queueName, jobId));
    } else {
      await this.saveJob(queueName, job);
    }
    this.getEventBus(queueName).emit("failed", { jobId, failedReason: job.failedReason });
  }

  async requeueStalled(queueName: string, maxStalledCount: number): Promise<string[]> {
    const now = Date.now();
    const ids = ((await this.client.zrangebyscore(this.activeKey(queueName), 0, now)) ??
      []) as string[];
    const requeued: string[] = [];

    for (const id of ids) {
      const job = await this.loadJob(queueName, id);
      if (!job || job.state !== "active" || !job.lockExpiresAt || job.lockExpiresAt > now) continue;

      job.lockToken = undefined;
      job.lockExpiresAt = undefined;
      job.stalledCount += 1;
      await this.client.zrem(this.activeKey(queueName), id);

      if (job.stalledCount > maxStalledCount) {
        job.state = "failed";
        job.failedReason = "job stalled more than allowable limit";
        job.finishedOn = now;
        await this.saveJob(queueName, job);
        this.getEventBus(queueName).emit("failed", { jobId: id, failedReason: job.failedReason });
        continue;
      }

      const paused = await this.client.get(this.pausedKey(queueName));
      job.state = paused === "1" ? "paused" : "waiting";
      await this.saveJob(queueName, job);
      await this.client.rpush(this.waitKey(queueName), id);
      requeued.push(id);
      this.getEventBus(queueName).emit("stalled", { jobId: id });
    }

    return requeued;
  }

  async updateProgress(queueName: string, jobId: string, progress: number | object): Promise<void> {
    const job = await this.loadJob(queueName, jobId);
    if (!job) return;
    job.progress = progress;
    await this.saveJob(queueName, job);
    this.getEventBus(queueName).emit("progress", { jobId, data: progress });
  }

  async getJob<T = any, R = any>(queueName: string, jobId: string): Promise<JobJson<T, R> | null> {
    return (await this.loadJob(queueName, jobId)) as JobJson<T, R> | null;
  }

  async count(queueName: string): Promise<number> {
    await this.promoteDelayed(queueName);
    const waiting = (await this.client.llen(this.waitKey(queueName))) ?? 0;
    const delayed = (await this.client.zcard(this.delayedKey(queueName))) ?? 0;
    return Number(waiting) + Number(delayed);
  }

  async pause(queueName: string): Promise<void> {
    await this.client.set(this.pausedKey(queueName), "1");
  }

  async resume(queueName: string): Promise<void> {
    await this.client.del(this.pausedKey(queueName));
    await this.promoteDelayed(queueName);
  }

  async close(): Promise<void> {
    await this.client.quit?.();
  }

  getEventBus(queueName: string): EventEmitter {
    return getQueueEventBus(queueName);
  }

  private async promoteDelayed(queueName: string) {
    const now = Date.now();
    const ids = ((await this.client.zrangebyscore(this.delayedKey(queueName), 0, now)) ??
      []) as string[];
    for (const id of ids) {
      const job = await this.loadJob(queueName, id);
      if (!job) continue;
      job.state = "waiting";
      job.delayUntil = undefined;
      await this.saveJob(queueName, job);
      await this.client.zrem(this.delayedKey(queueName), id);
      await this.client.rpush(this.waitKey(queueName), id);
      this.getEventBus(queueName).emit("waiting", { jobId: id });
    }
  }

  private async loadJob(queueName: string, jobId: string): Promise<JobJson | null> {
    const payload = await this.client.get(this.jobKey(queueName, jobId));
    if (!payload) return null;
    return JSON.parse(payload);
  }

  private async saveJob(queueName: string, job: JobJson): Promise<void> {
    await this.client.set(this.jobKey(queueName, job.id), JSON.stringify(job));
  }

  private jobKey(queueName: string, jobId: string): string {
    return `${this.baseKey(queueName)}:job:${jobId}`;
  }

  private waitKey(queueName: string): string {
    return `${this.baseKey(queueName)}:wait`;
  }

  private activeKey(queueName: string): string {
    return `${this.baseKey(queueName)}:active`;
  }

  private delayedKey(queueName: string): string {
    return `${this.baseKey(queueName)}:delayed`;
  }

  private pausedKey(queueName: string): string {
    return `${this.baseKey(queueName)}:paused`;
  }

  private baseKey(queueName: string): string {
    return `${this.prefix}:${queueName}`;
  }
}
