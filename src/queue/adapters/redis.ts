import type { QueueAdapter, Job, EnqueueOptions, JobStatus } from "../types";

// Assuming Bun.redis acts as a standard Redis client
// We will pass the client in the constructor
export class RedisQueue implements QueueAdapter {
  private client: any;
  private queueKey: string;
  private processingKey: string;
  private jobsKey: string;

  constructor(client: any, queueName: string = "default") {
    this.client = client;
    this.queueKey = `queue:${queueName}:pending`;
    this.processingKey = `queue:${queueName}:processing`;
    this.jobsKey = `queue:${queueName}:jobs`;
  }

  async enqueue<T>(payload: T, options?: EnqueueOptions): Promise<Job<T>> {
    const id = crypto.randomUUID();
    const now = Date.now();
    const maxAttempts = options?.maxAttempts ?? 3;
    const status: JobStatus = "pending";

    const job: Job<T> = {
      id,
      payload,
      status,
      attempts: 0,
      maxAttempts,
      createdAt: now,
      updatedAt: now,
    };

    // Store job details
    await this.client.hset(this.jobsKey, id, JSON.stringify(job));
    // Push job ID to the pending queue
    await this.client.lpush(this.queueKey, id);

    return job;
  }

  async dequeue(): Promise<Job | null> {
    // Atomically pop from pending queue and push to processing queue
    // rpoplpush is used or lmove
    const id = await this.client.rpoplpush(this.queueKey, this.processingKey);

    if (!id) return null;

    const jobData = await this.client.hget(this.jobsKey, id);
    if (!jobData) return null;

    const job: Job = JSON.parse(jobData);
    job.status = "processing";
    job.updatedAt = Date.now();

    await this.client.hset(this.jobsKey, id, JSON.stringify(job));

    return job;
  }

  async complete(jobId: string): Promise<void> {
    const jobData = await this.client.hget(this.jobsKey, jobId);
    if (!jobData) return;

    const job: Job = JSON.parse(jobData);
    job.status = "completed";
    job.updatedAt = Date.now();

    await this.client.hset(this.jobsKey, jobId, JSON.stringify(job));
    // Remove from processing queue
    await this.client.lrem(this.processingKey, 0, jobId);
  }

  async fail(jobId: string, error: Error): Promise<void> {
    const jobData = await this.client.hget(this.jobsKey, jobId);
    if (!jobData) return;

    const job: Job = JSON.parse(jobData);
    job.attempts += 1;
    job.error = error.message;
    job.updatedAt = Date.now();

    // Remove from processing queue
    await this.client.lrem(this.processingKey, 0, jobId);

    if (job.attempts < job.maxAttempts) {
      job.status = "pending";
      // Re-enqueue for retry
      await this.client.lpush(this.queueKey, jobId);
    } else {
      job.status = "failed";
    }

    await this.client.hset(this.jobsKey, jobId, JSON.stringify(job));
  }

  async size(): Promise<number> {
    return await this.client.llen(this.queueKey);
  }

  async clear(): Promise<void> {
    await this.client.del(this.queueKey);
    await this.client.del(this.processingKey);
    await this.client.del(this.jobsKey);
  }
}
