import type { TrustProxyOptions } from "./client-ip";

/**
 * Pluggable storage backend for the rate limiter.
 *
 * Implementations receive a `policy` on every `consume` call so a single
 * store instance can serve multiple limiters with different windows / limits.
 */
export interface RateLimitStore {
  consume(
    key: string,
    policy: RateLimitPolicy,
  ): RateLimitDecision | Promise<RateLimitDecision>;
}

/** The computed outcome of a single `consume` call. */
export interface RateLimitDecision {
  /** `true` when the request is allowed to proceed. */
  allowed: boolean;
  /** Number of tokens remaining after this consume. */
  remaining: number;
  /** Absolute epoch ms when the window / bucket resets to capacity. */
  resetMs: number;
  /** The effective limit for this policy. */
  limit: number;
}

/** Core rate-limit policy parameters. */
export interface RateLimitPolicy {
  /** Maximum requests per window (also the default burst capacity). */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Token-bucket burst capacity (defaults to `limit`). */
  burst: number;
}

/** Full factory-level configuration for the global rate limiter. */
export interface RateLimitOptions {
  /** Maximum requests per window. */
  limit: number;
  /** Window in milliseconds (e.g. 60_000 for 1 minute). */
  windowMs: number;
  /**
   * Token-bucket burst capacity. When requests arrive in a cluster, the
   * bucket allows up to `burst` requests before throttling starts. Defaults
   * to `limit` (no extra burst).
   */
  burst?: number;
  /** Custom store (default: `InMemoryTokenBucketStore`). */
  store?: RateLimitStore;
  /**
   * Custom function that extracts a rate-limit key from the request context.
   * Return `undefined` to fall back to the socket IP (trustProxy-aware).
   */
  keyExtractor?: (ctx: any) => string | undefined;
  /**
   * Trust-proxy configuration for client-IP resolution. Only consulted when
   * `keyExtractor` returns `undefined`. See `resolveClientIp` in
   * `src/security/client-ip.ts`.
   */
  trustProxy?: boolean | TrustProxyOptions;
  /**
   * Send `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`
   * response headers on every request (default: `true`).
   */
  headers?: boolean;
  /**
   * Path prefixes to skip entirely (e.g. `["/healthz", "/metrics"]`).
   * Compared with `String.startsWith`.
   */
  exclude?: string[];
}

/**
 * Compiled representation of a rate-limit policy, produced by
 * `compileRateLimitPolicy()` and stored on the adapter at boot time.
 */
export interface CompiledRateLimitPolicy extends RateLimitPolicy {
  store: RateLimitStore;
  keyExtractor: (ctx: any) => string | undefined;
  trustProxy: boolean | TrustProxyOptions | undefined;
  headers: boolean;
  exclude: string[];
}

// ---------------------------------------------------------------------------
// InMemoryTokenBucketStore
// ---------------------------------------------------------------------------

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

const LRU_CAP = 10_000;

/**
 * In-process token bucket store with continuous refill.
 *
 * On each `consume`, elapsed time is used to compute a fractional refill:
 * `tokens += (elapsed / windowMs) * burst`, capped at `burst`. If the bucket
 * has at least 1 token the request is allowed and the token is deducted.
 *
 * LRU eviction (Map-insertion-order trick) caps memory at 10k keys.
 */
export class InMemoryTokenBucketStore implements RateLimitStore {
  private readonly buckets = new Map<string, BucketState>();

  consume(key: string, policy: RateLimitPolicy): RateLimitDecision {
    const { limit, windowMs, burst } = policy;
    const now = Date.now();

    let state = this.buckets.get(key);

    if (state === undefined) {
      // New key: evict oldest entry when at capacity.
      if (this.buckets.size >= LRU_CAP) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      // Start at full capacity.
      state = { tokens: burst, lastRefillMs: now };
      this.buckets.set(key, state);
    } else {
      // Refresh LRU position: delete + re-insert.
      this.buckets.delete(key);
      this.buckets.set(key, state);

      // Continuous refill: add tokens proportional to elapsed time.
      const elapsed = now - state.lastRefillMs;
      if (elapsed > 0) {
        const refill = (elapsed / windowMs) * burst;
        state.tokens = Math.min(burst, state.tokens + refill);
        state.lastRefillMs = now;
      }
    }

    const allowed = state.tokens >= 1;
    if (allowed) {
      state.tokens -= 1;
    }

    const remaining = Math.max(0, Math.floor(state.tokens));
    // `resetMs` is when the bucket would refill enough for the next request.
    // For a denied request, that's when 1 token accrues.
    const tokensNeeded = allowed ? 0 : 1 - state.tokens;
    const msToNextToken = (tokensNeeded / burst) * windowMs;
    const resetMs = now + Math.ceil(msToNextToken);

    return { allowed, remaining, resetMs, limit };
  }
}

// ---------------------------------------------------------------------------
// compileRateLimitPolicy
// ---------------------------------------------------------------------------

/**
 * Takes a user-supplied {@link RateLimitOptions} object and returns a fully
 * resolved {@link CompiledRateLimitPolicy} ready for the adapter. Called once
 * at application boot so hot-path code only ever touches the compiled shape.
 */
export function compileRateLimitPolicy(options: RateLimitOptions): CompiledRateLimitPolicy {
  const burst = options.burst ?? options.limit;
  const store = options.store ?? new InMemoryTokenBucketStore();
  const keyExtractor = options.keyExtractor ?? (() => undefined);

  return {
    limit: options.limit,
    windowMs: options.windowMs,
    burst,
    store,
    keyExtractor,
    trustProxy: options.trustProxy,
    headers: options.headers !== false,
    exclude: options.exclude ?? [],
  };
}
