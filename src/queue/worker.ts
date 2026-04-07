import { EventEmitter } from "node:events";
import { createQueueDriver } from "./driver";
import { Job } from "./job";
import { Queue } from "./queue";
import type { QueueDriver, WorkerOptions } from "./types";

export type JobProcessor<T = any, R = any> = (job: Job<T, R>) => Promise<R> | R;

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

export class Worker<T = any, R = any> extends EventEmitter {
  private readonly queue: Queue<T, R>;
  private readonly driver: QueueDriver;
  private readonly concurrency: number;
  private readonly lockDuration: number;
  private readonly stalledInterval: number;
  private readonly maxStalledCount: number;
  private readonly drainDelay: number;
  private running = false;
  private activeJobs = new Set<Promise<void>>();
  private stalledTimer?: Timer;

  constructor(
    queueName: string | Queue<T, R>,
    private readonly processor: JobProcessor<T, R>,
    options: WorkerOptions = {},
  ) {
    super();
    this.queue = typeof queueName === "string" ? new Queue<T, R>(queueName, options) : queueName;
    this.driver = this.queue.driver ?? createQueueDriver(options.connection);
    this.concurrency = options.concurrency ?? 1;
    this.lockDuration = options.lockDuration ?? 30_000;
    this.stalledInterval = options.stalledInterval ?? 30_000;
    this.maxStalledCount = options.maxStalledCount ?? 1;
    this.drainDelay = options.drainDelay ?? 25;

    if (options.autorun !== false) {
      this.run();
    }
  }

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stalledTimer = setInterval(() => {
      void this.driver.requeueStalled(this.queue.name, this.maxStalledCount);
    }, this.stalledInterval);

    while (this.running) {
      while (this.running && this.activeJobs.size < this.concurrency) {
        const task = this.processNext();
        this.activeJobs.add(task);
        task.finally(() => this.activeJobs.delete(task));
      }

      if (!this.running) break;
      if (this.activeJobs.size === 0) {
        this.emit("drained");
      }
      await new Promise((resolve) => setTimeout(resolve, this.drainDelay));
    }
  }

  async close(): Promise<void> {
    this.running = false;
    if (this.stalledTimer) clearInterval(this.stalledTimer);
    await Promise.allSettled(this.activeJobs);
  }

  private async processNext(): Promise<void> {
    const lockToken = crypto.randomUUID();
    const raw = await this.driver.getNextJob(this.queue.name, lockToken, this.lockDuration);
    if (!raw) return;

    const job = this.queue.createJobFromRaw(raw);
    const heartbeat = setInterval(
      () => {
        void this.driver.extendLock(this.queue.name, job.id, lockToken, this.lockDuration);
      },
      Math.max(1_000, Math.floor(this.lockDuration / 2)),
    );

    try {
      this.emit("active", job);
      const result = await this.processor(job);
      clearInterval(heartbeat);
      await this.driver.complete(this.queue.name, job.id, lockToken, result);
      this.emit("completed", job, result);
    } catch (error) {
      clearInterval(heartbeat);
      const err = error instanceof Error ? error : new Error(String(error));
      const attempts = job.opts.attempts ?? 1;
      const shouldRetry = job.attemptsMade + 1 < attempts;
      const retryAt = shouldRetry
        ? Date.now() + getBackoffDelay(job.opts.backoff, job.attemptsMade + 1)
        : undefined;
      await this.driver.fail(this.queue.name, job.id, lockToken, err, retryAt);
      this.emit("failed", job, err);
    }
  }
}
