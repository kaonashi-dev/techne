import type { QueueAdapter, Job } from "./types";

export type JobHandler<T = any> = (job: Job<T>) => Promise<void> | void;

export interface WorkerOptions {
  queue: QueueAdapter;
  handler: JobHandler;
  concurrency?: number;
  /** @deprecated Use minPollingInterval / maxPollingInterval instead */
  pollingInterval?: number;
  minPollingInterval?: number;
  maxPollingInterval?: number;
}

export class Worker {
  private queue: QueueAdapter;
  private handler: JobHandler;
  private concurrency: number;
  private minPollingInterval: number;
  private maxPollingInterval: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;

  constructor(options: WorkerOptions) {
    this.queue = options.queue;
    this.handler = options.handler;
    this.concurrency = options.concurrency ?? 1;
    // pollingInterval kept for backwards compatibility: treated as minPollingInterval
    this.minPollingInterval = options.minPollingInterval ?? options.pollingInterval ?? 100;
    this.maxPollingInterval = options.maxPollingInterval ?? 30_000;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll(this.minPollingInterval);
  }

  stop() {
    this.isRunning = false;
  }

  private async poll(currentInterval: number) {
    if (!this.isRunning) return;

    if (this.activeJobs >= this.concurrency) {
      setTimeout(() => this.poll(currentInterval), currentInterval);
      return;
    }

    try {
      const job = await this.queue.dequeue();

      if (job) {
        this.activeJobs++;

        this.processJob(job).finally(() => {
          this.activeJobs--;
          setTimeout(() => this.poll(this.minPollingInterval), 0);
        });

        // Reset backoff — there may be more jobs waiting
        setTimeout(() => this.poll(this.minPollingInterval), 0);
      } else {
        // No jobs: back off exponentially up to maxPollingInterval
        const nextInterval = Math.min(currentInterval * 2, this.maxPollingInterval);
        setTimeout(() => this.poll(nextInterval), currentInterval);
      }
    } catch (err) {
      console.error("[Worker] Error while polling queue:", err);
      const nextInterval = Math.min(currentInterval * 2, this.maxPollingInterval);
      setTimeout(() => this.poll(nextInterval), currentInterval);
    }
  }

  private async processJob(job: Job) {
    try {
      await this.handler(job);
      await this.queue.complete(job.id);
    } catch (error: any) {
      console.error(`[Worker] Job ${job.id} failed:`, error.message);
      await this.queue.fail(job.id, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
