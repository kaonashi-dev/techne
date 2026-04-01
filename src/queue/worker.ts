import type { QueueAdapter, Job } from "./types";

export type JobHandler<T = any> = (job: Job<T>) => Promise<void> | void;

export interface WorkerOptions {
  queue: QueueAdapter;
  handler: JobHandler;
  concurrency?: number;
  pollingInterval?: number;
}

export class Worker {
  private queue: QueueAdapter;
  private handler: JobHandler;
  private concurrency: number;
  private pollingInterval: number;
  private isRunning: boolean = false;
  private activeJobs: number = 0;

  constructor(options: WorkerOptions) {
    this.queue = options.queue;
    this.handler = options.handler;
    this.concurrency = options.concurrency ?? 1;
    this.pollingInterval = options.pollingInterval ?? 1000;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.poll();
  }

  stop() {
    this.isRunning = false;
  }

  private async poll() {
    if (!this.isRunning) return;

    if (this.activeJobs >= this.concurrency) {
      // If we are fully saturated, wait a bit before checking again
      setTimeout(() => this.poll(), this.pollingInterval);
      return;
    }

    try {
      // Try to get a job
      const job = await this.queue.dequeue();

      if (job) {
        // We found a job! Let's process it.
        this.activeJobs++;

        // Don't await here, process it concurrently
        this.processJob(job).finally(() => {
          this.activeJobs--;
          // Immediately try to poll again after finishing a job
          // (setImmediate/setTimeout to avoid max call stack)
          setTimeout(() => this.poll(), 0);
        });

        // We might be able to handle more jobs, poll again immediately
        setTimeout(() => this.poll(), 0);
      } else {
        // No jobs in queue, wait a bit before polling again
        setTimeout(() => this.poll(), this.pollingInterval);
      }
    } catch (err) {
      console.error("[Worker] Error while polling queue:", err);
      // Wait before retrying to prevent hot loop on error
      setTimeout(() => this.poll(), this.pollingInterval);
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
