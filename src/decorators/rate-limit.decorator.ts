import type { RateLimitOptions } from "../security/rate-limit";

/**
 * Metadata key for `@RateLimit()` decorator — stored on handler or
 * controller prototypes via `Reflect.defineMetadata`.
 */
export const RATE_LIMIT_METADATA = "techne:rate_limit";

/**
 * Per-route / per-controller rate-limit override.
 *
 * Usage:
 * ```ts
 * // Tighter limit on a specific handler
 * @RateLimit({ limit: 10, windowMs: 60_000 })
 * async sensitiveAction() { ... }
 *
 * // Exempt a route or whole controller from the global limiter
 * @RateLimit(false)
 * async publicEndpoint() { ... }
 * ```
 *
 * - An **options object** defines a per-route policy. The global limiter is
 *   bypassed for this route; only the per-route policy applies.
 * - **`false`** marks the route/controller as fully exempt from the global
 *   rate limiter (no per-route limit either).
 */
export function RateLimit(
  options: Pick<RateLimitOptions, "limit" | "windowMs" | "burst"> | false,
): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol, _descriptor?: any) => {
    const decoratorTarget = propertyKey !== undefined ? target[propertyKey as string] : target;
    Reflect.defineMetadata(RATE_LIMIT_METADATA, options, decoratorTarget);
  };
}
