import type { QueueAdapter, Job, EnqueueOptions } from "../types";

export class MemoryQueue implements QueueAdapter {
  private jobs: Map<string, Job> = new Map();
  // We'll use an array for the queue to easily pop the oldest item
  private queue: string[] = [];

  enqueue<T>(payload: T, options?: EnqueueOptions): Job<T> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const job: Job<T> = {
      id,
      payload,
      status: "pending",
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(id, job);
    this.queue.push(id);

    return job;
  }

  dequeue(): Job | null {
    if (this.queue.length === 0) return null;

    // In a real concurrent environment we might want more locks,
    // but JS is single threaded so this synchronous shift is safe
    const id = this.queue.shift();
    if (!id) return null;

    const job = this.jobs.get(id);
    if (!job) return null;

    job.status = "processing";
    job.updatedAt = Date.now();

    return job;
  }

  complete(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "completed";
      job.updatedAt = Date.now();
      // We could optionally remove it from the map to save memory:
      // this.jobs.delete(jobId);
    }
  }

  fail(jobId: string, error: Error): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.attempts += 1;
    job.error = error.message;
    job.updatedAt = Date.now();

    if (job.attempts < job.maxAttempts) {
      job.status = "pending";
      // Re-enqueue for retry
      this.queue.push(job.id);
    } else {
      job.status = "failed";
    }
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.jobs.clear();
    this.queue = [];
  }
}
