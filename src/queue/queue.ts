import { EventEmitter } from "node:events";
import { createQueueDriver } from "./driver";
import { Job } from "./job";
import type { JobJson, JobsOptions, QueueDriver, QueueOptions } from "./types";

export class Queue<T = any, R = any> extends EventEmitter {
  readonly name: string;
  readonly driver: QueueDriver;
  readonly opts: QueueOptions;

  constructor(name: string, options: QueueOptions = {}, driver?: QueueDriver) {
    super();
    this.name = name;
    this.opts = options;
    this.driver = driver ?? createQueueDriver(options.connection);
  }

  async add(name: string, data: T, options: JobsOptions = {}): Promise<Job<T, R>> {
    const job = await this.driver.add(this.name, name, data, this.mergeOptions(options));
    return Job.fromJson<T, R>(this.driver, job);
  }

  async addBulk(
    jobs: Array<{ name: string; data: T; options?: JobsOptions }>,
  ): Promise<Array<Job<T, R>>> {
    const added = await this.driver.addBulk(
      this.name,
      jobs.map((job) => ({
        name: job.name,
        data: job.data,
        options: this.mergeOptions(job.options ?? {}),
      })),
    );
    return added.map((job) => Job.fromJson<T, R>(this.driver, job));
  }

  async getJob(jobId: string): Promise<Job<T, R> | null> {
    const job = await this.driver.getJob<T, R>(this.name, jobId);
    return job ? Job.fromJson<T, R>(this.driver, job) : null;
  }

  async count(): Promise<number> {
    return this.driver.count(this.name);
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

  private mergeOptions(options: JobsOptions): JobsOptions {
    return {
      ...this.opts.defaultJobOptions,
      ...options,
    };
  }

  createJobFromRaw(job: JobJson<T, R>): Job<T, R> {
    return Job.fromJson<T, R>(this.driver, job);
  }
}
