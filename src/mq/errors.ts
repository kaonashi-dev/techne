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
