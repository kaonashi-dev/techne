import { getDriverContext } from "../dispatcher";
import type { Job } from "../job";
import type { JobMiddleware } from "../types";

// ── RateLimited ───────────────────────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
}

const buckets = new Map<string, TokenBucket>();

/**
 * Token-bucket rate limiter. At most `maxPerWindow` jobs are allowed through
 * per `windowMs`. Extra jobs are released (re-enqueued with a delay) rather
 * than dropped or failed.
 *
 * @example
 *   middleware() {
 *     return [new RateLimited("payments", 10, 60_000)];
 *   }
 */
export class RateLimited implements JobMiddleware {
  constructor(
    private readonly name: string,
    private readonly maxPerWindow: number = 10,
    private readonly windowMs: number = 60_000,
  ) {}

  handle(job: Job, next: () => Promise<unknown>): Promise<unknown> {
    const now = Date.now();
    let bucket = buckets.get(this.name);
    if (!bucket || now - bucket.lastRefillAt >= this.windowMs) {
      bucket = { tokens: this.maxPerWindow, lastRefillAt: now };
      buckets.set(this.name, bucket);
    }
    if (bucket.tokens <= 0) {
      const waitMs = this.windowMs - (now - bucket.lastRefillAt);
      job.release(Math.ceil(waitMs / 1000));
    }
    bucket.tokens--;
    return next();
  }
}

// ── WithoutOverlapping ────────────────────────────────────────────────────────

/**
 * Prevents two instances of the same logical job from running concurrently.
 * Uses the driver's `acquireUniqueLock` / `releaseUniqueLock` primitives.
 * If the lock is already held the job is released (re-enqueued after 5 s).
 *
 * @example
 *   middleware() {
 *     return [new WithoutOverlapping("process-report", 60_000)];
 *   }
 */
export class WithoutOverlapping implements JobMiddleware {
  constructor(
    private readonly key: string,
    private readonly ttlMs: number = 60_000,
  ) {}

  async handle(job: Job, next: () => Promise<unknown>): Promise<unknown> {
    const driver = getDriverContext();
    if (!driver) return next(); // no driver context — skip locking (e.g. dispatchSync)
    const lockKey = `overlap:${this.key}`;
    const acquired = await driver.acquireUniqueLock(lockKey, this.ttlMs);
    if (!acquired) {
      job.release(5); // retry in 5 s; release() never returns
    }
    try {
      return await next();
    } finally {
      await driver.releaseUniqueLock(lockKey);
    }
  }
}

// ── ThrottlesExceptions ───────────────────────────────────────────────────────

interface ThrottleState {
  failures: number;
  windowStartedAt: number;
}

const throttleStates = new Map<string, ThrottleState>();

/**
 * After `maxFailures` exceptions within `decayMs` milliseconds, further
 * attempts are released (re-enqueued with a delay) instead of propagating
 * the error. The failure window resets after `decayMs` has elapsed.
 *
 * @example
 *   middleware() {
 *     return [new ThrottlesExceptions(3, 60_000)];
 *   }
 */
export class ThrottlesExceptions implements JobMiddleware {
  constructor(
    private readonly maxFailures: number,
    private readonly decayMs: number,
  ) {}

  async handle(job: Job, next: () => Promise<unknown>): Promise<unknown> {
    const key = `${job.queueName}:${job.name}`;
    const now = Date.now();
    let state = throttleStates.get(key);
    if (!state || now - state.windowStartedAt >= this.decayMs) {
      state = { failures: 0, windowStartedAt: now };
      throttleStates.set(key, state);
    }
    if (state.failures >= this.maxFailures) {
      const waitMs = this.decayMs - (now - state.windowStartedAt);
      job.release(Math.ceil(waitMs / 1000));
    }
    try {
      return await next();
    } catch (err) {
      state.failures++;
      throw err;
    }
  }
}

/** @internal Exposed for test cleanup only — clears all in-process rate-limit and throttle state. */
export function clearMiddlewareState(): void {
  buckets.clear();
  throttleStates.clear();
}
