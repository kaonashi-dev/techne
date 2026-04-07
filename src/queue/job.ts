import type { JobJson, QueueDriver } from "./types";

export class Job<T = any, R = any> {
  id: string;
  name: string;
  data: T;
  queueName: string;
  opts;
  attemptsMade: number;
  progress: number | object;
  processedOn?: number;
  finishedOn?: number;
  returnValue?: R;
  failedReason?: string;
  stacktrace: string[];

  constructor(
    private readonly driver: QueueDriver,
    private readonly raw: JobJson<T, R>,
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

  static fromJson<T = any, R = any>(driver: QueueDriver, raw: JobJson<T, R>): Job<T, R> {
    return new Job(driver, raw);
  }

  async updateProgress(progress: number | object): Promise<void> {
    this.progress = progress;
    await this.driver.updateProgress(this.queueName, this.id, progress);
  }

  toJSON(): JobJson<T, R> {
    return { ...this.raw, progress: this.progress, returnValue: this.returnValue };
  }
}
