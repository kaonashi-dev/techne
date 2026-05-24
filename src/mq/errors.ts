export class MissingLockError extends Error {
  constructor(jobId: string) {
    super(`Missing lock for job ${jobId}`);
  }
}

export class JobNotUniqueError extends Error {
  constructor(lockKey: string) {
    super(`Job is already queued: ${lockKey}`);
    this.name = "JobNotUniqueError";
  }
}

/**
 * Thrown by `job.release(seconds)` to re-enqueue the job after a delay
 * without incrementing the failure attempt counter.
 */
export class JobReleasedError extends Error {
  constructor(public readonly delayMs: number) {
    super(`Job released for retry after ${delayMs}ms`);
    this.name = "JobReleasedError";
  }
}
