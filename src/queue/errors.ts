export class MissingLockError extends Error {
  constructor(jobId: string) {
    super(`Missing lock for job ${jobId}`);
  }
}
