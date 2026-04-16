import { createMqDriver } from "./driver";
import { Job } from "./job";
import type { JobJson, JobState, JobsOptions, QueueDriver, QueueOptions } from "./types";

export class Queue<T = unknown, R = unknown> {
  readonly name: string;
  readonly driver: QueueDriver;
  readonly opts: QueueOptions;

  constructor(name: string, options: QueueOptions = {}, driver?: QueueDriver) {
    this.name = name;
    this.opts = options;
    this.driver = driver ?? createMqDriver(options.connection);
  }

  async add(name: string, data: T, opts: JobsOptions = {}): Promise<Job<T, R>> {
    const job = await this.driver.add(this.name, name, data, this.mergeOptions(opts));
    return Job.fromJson<T, R>(this.driver, job as JobJson<T, R>);
  }

  async addBulk(
    jobs: Array<{ name: string; data: T; opts?: JobsOptions }>,
  ): Promise<Array<Job<T, R>>> {
    const added = await this.driver.addBulk(
      this.name,
      jobs.map((job) => ({
        name: job.name,
        data: job.data,
        opts: this.mergeOptions(job.opts ?? {}),
      })),
    );
    return added.map((job) => Job.fromJson<T, R>(this.driver, job as JobJson<T, R>));
  }

  async getJob(jobId: string): Promise<Job<T, R> | null> {
    const job = await this.driver.getJob<T, R>(this.name, jobId);
    return job ? Job.fromJson<T, R>(this.driver, job) : null;
  }

  async getJobCounts(...states: JobState[]): Promise<Partial<Record<JobState, number>>> {
    return await this.driver.getJobCounts(this.name, states.length > 0 ? states : undefined);
  }

  async pause(): Promise<void> {
    await this.driver.pause(this.name);
  }

  async resume(): Promise<void> {
    await this.driver.resume(this.name);
  }

  async close(): Promise<void> {
    await this.driver.close();
  }

  createJobFromRaw(raw: JobJson<T, R>): Job<T, R> {
    return Job.fromJson<T, R>(this.driver, raw);
  }

  private mergeOptions(options: JobsOptions): JobsOptions {
    return {
      ...this.opts.defaultJobOptions,
      ...options,
    };
  }
}
