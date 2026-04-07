import type { EventEmitter } from "node:events";
import type { JobJson, JobsOptions, QueueDriver } from "../types";
import { getQueueEventBus } from "../event-bus";
import { MissingLockError } from "../errors";

interface MemoryQueueState {
  jobs: Map<string, JobJson>;
  waiting: string[];
  delayed: string[];
  paused: boolean;
}

function cloneJob<T = any, R = any>(job: JobJson<T, R>): JobJson<T, R> {
  return JSON.parse(JSON.stringify(job));
}

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

export class MemoryQueueDriver implements QueueDriver {
  private queues = new Map<string, MemoryQueueState>();

  private getState(queueName: string): MemoryQueueState {
    let state = this.queues.get(queueName);
    if (!state) {
      state = {
        jobs: new Map(),
        waiting: [],
        delayed: [],
        paused: false,
      };
      this.queues.set(queueName, state);
    }
    this.promoteDelayed(queueName, state);
    return state;
  }

  async add<T>(
    queueName: string,
    name: string,
    data: T,
    options: JobsOptions,
  ): Promise<JobJson<T>> {
    const state = this.getState(queueName);
    const now = Date.now();
    const normalized = normalizeOptions(options);
    const id = normalized.jobId ?? crypto.randomUUID();
    const job: JobJson<T> = {
      id,
      name,
      data,
      queueName,
      opts: normalized,
      state:
        normalized.delay && normalized.delay > 0 ? "delayed" : state.paused ? "paused" : "waiting",
      timestamp: now,
      attemptsMade: 0,
      progress: 0,
      delayUntil: normalized.delay && normalized.delay > 0 ? now + normalized.delay : undefined,
      stacktrace: [],
      stalledCount: 0,
    };

    state.jobs.set(id, job);
    if (job.state === "delayed") {
      state.delayed.push(id);
    } else if (job.state === "paused") {
      state.waiting.push(id);
    } else {
      state.waiting.push(id);
      this.getEventBus(queueName).emit("waiting", { jobId: id });
    }

    return cloneJob(job);
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
    const state = this.getState(queueName);
    if (state.paused) return null;

    const id = state.waiting.shift();
    if (!id) return null;

    const job = state.jobs.get(id);
    if (!job) return null;

    const now = Date.now();
    job.state = "active";
    job.processedOn = now;
    job.lockToken = lockToken;
    job.lockExpiresAt = now + lockDuration;
    this.getEventBus(queueName).emit("active", { jobId: job.id });
    return cloneJob(job);
  }

  async extendLock(
    queueName: string,
    jobId: string,
    lockToken: string,
    duration: number,
  ): Promise<boolean> {
    const job = this.getState(queueName).jobs.get(jobId);
    if (!job || job.lockToken !== lockToken || job.state !== "active") return false;
    job.lockExpiresAt = Date.now() + duration;
    return true;
  }

  async complete<R>(
    queueName: string,
    jobId: string,
    lockToken: string,
    returnValue?: R,
  ): Promise<void> {
    const state = this.getState(queueName);
    const job = state.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);
    job.state = "completed";
    job.returnValue = returnValue;
    job.finishedOn = Date.now();
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;
    this.getEventBus(queueName).emit("completed", { jobId: job.id, returnValue });
    if (job.opts.removeOnComplete) {
      state.jobs.delete(job.id);
    }
  }

  async fail(
    queueName: string,
    jobId: string,
    lockToken: string,
    error: Error,
    retryAt?: number,
  ): Promise<void> {
    const state = this.getState(queueName);
    const job = state.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);

    job.attemptsMade += 1;
    job.failedReason = error.message;
    job.stacktrace.push(error.stack ?? error.message);
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;

    if (retryAt && job.attemptsMade < (job.opts.attempts ?? 1)) {
      job.state = "delayed";
      job.delayUntil = retryAt;
      state.delayed.push(job.id);
      this.getEventBus(queueName).emit("waiting", { jobId: job.id });
      return;
    }

    job.state = "failed";
    job.finishedOn = Date.now();
    this.getEventBus(queueName).emit("failed", { jobId: job.id, failedReason: job.failedReason });
    if (job.opts.removeOnFail) {
      state.jobs.delete(job.id);
    }
  }

  async requeueStalled(queueName: string, maxStalledCount: number): Promise<string[]> {
    const state = this.getState(queueName);
    const now = Date.now();
    const requeued: string[] = [];
    for (const job of state.jobs.values()) {
      if (job.state !== "active" || !job.lockExpiresAt || job.lockExpiresAt > now) continue;
      job.lockToken = undefined;
      job.lockExpiresAt = undefined;
      job.stalledCount += 1;

      if (job.stalledCount > maxStalledCount) {
        job.state = "failed";
        job.failedReason = "job stalled more than allowable limit";
        job.finishedOn = now;
        this.getEventBus(queueName).emit("failed", {
          jobId: job.id,
          failedReason: job.failedReason,
        });
        continue;
      }

      job.state = state.paused ? "paused" : "waiting";
      state.waiting.push(job.id);
      requeued.push(job.id);
      this.getEventBus(queueName).emit("stalled", { jobId: job.id });
    }
    return requeued;
  }

  async updateProgress(queueName: string, jobId: string, progress: number | object): Promise<void> {
    const job = this.getState(queueName).jobs.get(jobId);
    if (!job) return;
    job.progress = progress;
    this.getEventBus(queueName).emit("progress", { jobId: job.id, data: progress });
  }

  async getJob<T = any, R = any>(queueName: string, jobId: string): Promise<JobJson<T, R> | null> {
    const job = this.getState(queueName).jobs.get(jobId);
    return job ? cloneJob(job) : null;
  }

  async count(queueName: string): Promise<number> {
    const state = this.getState(queueName);
    return state.waiting.length + state.delayed.length;
  }

  async pause(queueName: string): Promise<void> {
    this.getState(queueName).paused = true;
  }

  async resume(queueName: string): Promise<void> {
    const state = this.getState(queueName);
    state.paused = false;
    this.promoteDelayed(queueName, state);
  }

  async close(): Promise<void> {}

  getEventBus(queueName: string): EventEmitter {
    return getQueueEventBus(queueName);
  }

  private promoteDelayed(queueName: string, state: MemoryQueueState) {
    const now = Date.now();
    const remaining: string[] = [];
    for (const id of state.delayed) {
      const job = state.jobs.get(id);
      if (!job) continue;
      if ((job.delayUntil ?? 0) <= now) {
        job.state = state.paused ? "paused" : "waiting";
        job.delayUntil = undefined;
        state.waiting.push(id);
        this.getEventBus(queueName).emit("waiting", { jobId: id });
      } else {
        remaining.push(id);
      }
    }
    state.delayed = remaining;
  }
}
