export type MqDriverType = "memory" | "redis";

export interface RedisClientAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  rpush(key: string, ...values: string[]): Promise<unknown>;
  lpush(key: string, ...values: string[]): Promise<unknown>;
  lpop(key: string): Promise<string | null>;
  llen(key: string): Promise<number>;
  blpop(key: string, timeoutSeconds: number): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrem(key: string, member: string): Promise<unknown>;
  zcard(key: string): Promise<number>;
  zrangebyscore(key: string, min: number, max: number): Promise<string[]>;
  zrange(key: string, start: number, stop: number, withScores?: boolean): Promise<string[]>;
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<() => Promise<void> | void>;
  /** SET key value NX PX ttlMs — returns true if the key was set (didn't already exist). */
  setnx(key: string, value: string, ttlMs: number): Promise<boolean>;
  quit(): Promise<void>;
}

export interface MqConnectionOptions {
  driver?: MqDriverType;
  url?: string;
  prefix?: string;
  client?: unknown;
  subscriber?: unknown;
  clientFactory?: () => unknown;
  subscriberFactory?: () => unknown;
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
  /** Internal: unique lock key stored on the job for release on completion/failure. */
  lockKey?: string;
  /**
   * Internal: when `true` the unique lock should be released as soon as the
   * worker claims the job (before `handle()` runs) rather than after completion.
   */
  lockUntilProcessing?: boolean;
}

export interface QueueOptions {
  connection?: MqConnectionOptions;
  defaultJobOptions?: JobsOptions;
}

export interface MqModuleOptions extends QueueOptions {}

export interface RegisterQueueOptions extends QueueOptions {
  name: string;
}

export type JobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "paused";

export type QueueEventName =
  | "waiting"
  | "active"
  | "completed"
  | "failed"
  | "progress"
  | "stalled"
  | "drained";

export interface JobJson<T = unknown, R = unknown> {
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

export interface QueueEvent {
  event: QueueEventName;
  payload: Record<string, unknown>;
}

export interface ClaimNextOptions {
  lockToken: string;
  lockDuration: number;
  blockTimeout?: number;
}

export interface QueueDriver {
  add<T>(queueName: string, name: string, data: T, options: JobsOptions): Promise<JobJson<T>>;
  addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; opts: JobsOptions }>,
  ): Promise<Array<JobJson<T>>>;
  claimNext(queueName: string, options: ClaimNextOptions): Promise<JobJson | null>;
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
  getJob<T = unknown, R = unknown>(queueName: string, jobId: string): Promise<JobJson<T, R> | null>;
  getJobCounts(queueName: string, states?: JobState[]): Promise<Partial<Record<JobState, number>>>;
  pause(queueName: string): Promise<void>;
  resume(queueName: string): Promise<void>;
  close(): Promise<void>;
  subscribe(
    queueName: string,
    listener: (event: QueueEvent) => void,
  ): Promise<() => Promise<void> | void>;
  acquireUniqueLock(lockKey: string, ttlMs: number): Promise<boolean>;
  releaseUniqueLock(lockKey: string): Promise<void>;
}

export interface WorkerOptions extends QueueOptions {
  concurrency?: number;
  autorun?: boolean;
  lockDuration?: number;
  stalledInterval?: number;
  maxStalledCount?: number;
  blockTimeout?: number;
}

export interface MqProcessorMetadata {
  queueName: string;
  options: WorkerOptions;
}

export type ProcessMetadata = Record<string, string | undefined>;
