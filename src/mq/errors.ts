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

/**
 * Thrown when a queue job payload fails schema validation.
 *
 * At dispatch-time (`validate: "dispatch"` or `"both"`), this is thrown
 * synchronously before the job is enqueued.
 *
 * At consume-time (`validate: "consume"` or `"both"`), this is thrown
 * inside the worker handler, which flows into the existing `@OnFailure` /
 * `Dispatchable.failed()` lifecycle.
 */
export class QueuePayloadValidationError extends Error {
  constructor(
    public readonly jobName: string,
    public readonly queueName: string,
    public readonly errors: Array<{ path: string; message: string }>,
  ) {
    super(
      `Queue payload validation failed for ${queueName}/${jobName}: ${errors.map((e) => e.message).join(", ")}`,
    );
    this.name = "QueuePayloadValidationError";
  }
}
