import type { JobJson, JobsOptions, JobState, QueueDriver } from "./types";

export class Job<T = unknown, R = unknown> {
  id: string;
  name: string;
  data: T;
  queueName: string;
  opts: JobsOptions;
  attemptsMade: number;
  progress: number | object;
  processedOn?: number;
  finishedOn?: number;
  returnValue?: R;
  failedReason?: string;
  stacktrace: string[];

  constructor(
    private readonly driver: QueueDriver,
    private raw: JobJson<T, R>,
  ) {
    this.id = raw.id;
    this.name = raw.name;
    this.data = raw.data;
    this.queueName = raw.queueName;
    this.opts = raw.opts;
    this.attemptsMade = raw.attemptsMade;
    this.progress = raw.progress;
    this.processedOn = raw.processedOn;
    this.finishedOn = raw.finishedOn;
    this.returnValue = raw.returnValue;
    this.failedReason = raw.failedReason;
    this.stacktrace = raw.stacktrace;
  }

  static fromJson<T = unknown, R = unknown>(driver: QueueDriver, raw: JobJson<T, R>): Job<T, R> {
    return new Job(driver, raw);
  }

  async updateProgress(progress: number | object): Promise<void> {
    this.progress = progress;
    this.raw.progress = progress;
    await this.driver.updateProgress(this.queueName, this.id, progress);
  }

  async getState(): Promise<JobState> {
    const job = await this.driver.getJob<T, R>(this.queueName, this.id);
    if (!job) {
      return this.raw.state;
    }
    this.refresh(job);
    return job.state;
  }

  toJSON(): JobJson<T, R> {
    return {
      ...this.raw,
      attemptsMade: this.attemptsMade,
      progress: this.progress,
      processedOn: this.processedOn,
      finishedOn: this.finishedOn,
      returnValue: this.returnValue,
      failedReason: this.failedReason,
      stacktrace: [...this.stacktrace],
    };
  }

  refresh(raw: JobJson<T, R>): void {
    this.raw = raw;
    this.attemptsMade = raw.attemptsMade;
    this.progress = raw.progress;
    this.processedOn = raw.processedOn;
    this.finishedOn = raw.finishedOn;
    this.returnValue = raw.returnValue;
    this.failedReason = raw.failedReason;
    this.stacktrace = [...raw.stacktrace];
  }
}
