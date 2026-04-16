import { EventEmitter } from "node:events";
import { createMqDriver } from "./driver";
import { Job } from "./job";
import { Queue } from "./queue";
import type { QueueDriver, WorkerOptions } from "./types";

export type JobProcessor<T = unknown, R = unknown> = (job: Job<T, R>) => Promise<R> | R;

function getBackoffDelay(
  backoff: number | { type: "fixed" | "exponential"; delay: number } | undefined,
  attemptsMade: number,
): number {
  if (!backoff) return 0;
  if (typeof backoff === "number") return backoff;
  if (backoff.type === "exponential") {
    return backoff.delay * 2 ** Math.max(0, attemptsMade - 1);
  }
  return backoff.delay;
}

export class Worker<T = unknown, R = unknown> extends EventEmitter {
  private readonly queue: Queue<T, R>;
  private readonly driver: QueueDriver;
  private readonly concurrency: number;
  private readonly lockDuration: number;
  private readonly stalledInterval: number;
  private readonly maxStalledCount: number;
  private readonly blockTimeout: number;
  private readonly runners = new Set<Promise<void>>();
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private reaper?: ReturnType<typeof setInterval>;
  private running = false;
  private paused = false;
  private idle = false;

  constructor(
    queueName: string | Queue<T, R>,
    private readonly processor: JobProcessor<T, R>,
    options: WorkerOptions = {},
  ) {
    super();
    this.queue = typeof queueName === "string" ? new Queue<T, R>(queueName, options) : queueName;
    this.driver = this.queue.driver ?? createMqDriver(options.connection);
    this.concurrency = options.concurrency ?? 1;
    this.lockDuration = options.lockDuration ?? 30_000;
    this.stalledInterval = options.stalledInterval ?? 30_000;
    this.maxStalledCount = options.maxStalledCount ?? 1;
    this.blockTimeout = options.blockTimeout ?? 1_000;

    if (options.autorun !== false) {
      void this.run();
    }
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.reaper = setInterval(() => {
      void this.driver.requeueStalled(this.queue.name, this.maxStalledCount);
    }, this.stalledInterval);

    for (let index = 0; index < this.concurrency; index += 1) {
      const runner = this.runLoop();
      this.runners.add(runner);
      runner.finally(() => this.runners.delete(runner));
    }

    await Promise.allSettled(this.runners);
  }

  async pause(): Promise<void> {
    this.paused = true;
    await this.queue.pause();
  }

  async resume(): Promise<void> {
    this.paused = false;
    await this.queue.resume();
  }

  async close(): Promise<void> {
    this.running = false;
    if (this.reaper) clearInterval(this.reaper);
    for (const timer of this.heartbeats.values()) {
      clearInterval(timer);
    }
    await Promise.allSettled(this.runners);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      if (this.paused) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        continue;
      }

      const lockToken = crypto.randomUUID();
      const raw = await this.driver.claimNext(this.queue.name, {
        lockToken,
        lockDuration: this.lockDuration,
        blockTimeout: this.blockTimeout,
      });

      if (!raw) {
        if (!this.idle) {
          this.idle = true;
          this.emit("drained");
        }
        continue;
      }

      this.idle = false;
      const job = this.queue.createJobFromRaw(raw as import("./types").JobJson<T, R>);
      const heartbeat = setInterval(
        () => {
          void this.driver.extendLock(this.queue.name, job.id, lockToken, this.lockDuration);
        },
        Math.max(1_000, Math.floor(this.lockDuration / 2)),
      );
      this.heartbeats.set(job.id, heartbeat);

      try {
        this.emit("active", job);
        const result = await this.processor(job);
        clearInterval(heartbeat);
        this.heartbeats.delete(job.id);
        await this.driver.complete(this.queue.name, job.id, lockToken, result);
        const refreshed = await this.queue.getJob(job.id);
        if (refreshed) {
          job.refresh(refreshed.toJSON());
        }
        this.emit("completed", job, result);
      } catch (error) {
        clearInterval(heartbeat);
        this.heartbeats.delete(job.id);
        const err = error instanceof Error ? error : new Error(String(error));
        const attempts = job.opts.attempts ?? 1;
        const shouldRetry = job.attemptsMade + 1 < attempts;
        const retryAt = shouldRetry
          ? Date.now() + getBackoffDelay(job.opts.backoff, job.attemptsMade + 1)
          : undefined;
        await this.driver.fail(this.queue.name, job.id, lockToken, err, retryAt);
        const refreshed = await this.queue.getJob(job.id);
        if (refreshed) {
          job.refresh(refreshed.toJSON());
        }
        this.emit("failed", job, err);
      }
    }
  }
}
