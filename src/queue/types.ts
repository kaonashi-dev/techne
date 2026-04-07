import type { EventEmitter } from "node:events";

export type QueueDriverType = "memory" | "redis";

export interface QueueConnectionOptions {
  driver?: QueueDriverType;
  url?: string;
  prefix?: string;
  client?: any;
  clientFactory?: () => any;
}

export interface BackoffOptions {
  type: "fixed" | "exponential";
  delay: number;
}

export interface JobsOptions {
  jobId?: string;
  delay?: number;
  attempts?: number;
  backoff?: number | BackoffOptions;
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
}

export interface QueueOptions {
  connection?: QueueConnectionOptions;
  defaultJobOptions?: JobsOptions;
}

export interface QueueModuleOptions extends QueueOptions {}

export interface RegisterQueueOptions extends QueueOptions {
  name: string;
}

export type JobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";

export interface JobJson<T = any, R = any> {
  id: string;
  name: string;
  data: T;
  queueName: string;
  opts: JobsOptions;
  state: JobState;
  timestamp: number;
  attemptsMade: number;
  progress: number | object;
  processedOn?: number;
  finishedOn?: number;
  delayUntil?: number;
  returnValue?: R;
  failedReason?: string;
  stacktrace: string[];
  stalledCount: number;
  lockToken?: string;
  lockExpiresAt?: number;
}

export interface QueueDriver {
  add<T>(queueName: string, name: string, data: T, options: JobsOptions): Promise<JobJson<T>>;
  addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options: JobsOptions }>,
  ): Promise<Array<JobJson<T>>>;
  getNextJob(queueName: string, lockToken: string, lockDuration: number): Promise<JobJson | null>;
  extendLock(
    queueName: string,
    jobId: string,
    lockToken: string,
    duration: number,
  ): Promise<boolean>;
  complete<R>(queueName: string, jobId: string, lockToken: string, returnValue?: R): Promise<void>;
  fail(
    queueName: string,
    jobId: string,
    lockToken: string,
    error: Error,
    retryAt?: number,
  ): Promise<void>;
  requeueStalled(queueName: string, maxStalledCount: number): Promise<string[]>;
  updateProgress(queueName: string, jobId: string, progress: number | object): Promise<void>;
  getJob<T = any, R = any>(queueName: string, jobId: string): Promise<JobJson<T, R> | null>;
  count(queueName: string): Promise<number>;
  pause(queueName: string): Promise<void>;
  resume(queueName: string): Promise<void>;
  close(): Promise<void>;
  getEventBus(queueName: string): EventEmitter;
}

export interface WorkerOptions extends QueueOptions {
  concurrency?: number;
  autorun?: boolean;
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  drainDelay?: number;
}

export interface ProcessorOptions extends WorkerOptions {
  name: string;
}

export interface QueueProcessorMetadata {
  queueName: string;
  options: WorkerOptions;
}

export type ProcessMetadata = Record<string, string | undefined>;
