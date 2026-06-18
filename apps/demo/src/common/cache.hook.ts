import type { ResponseHook, ResponseHookContext } from "../../../../src/common/index.ts";

/**
 * A response hook applied with `@OnResponse(...)`. It stamps a `cache-control`
 * header onto the outgoing response without touching the handler's return value.
 */
export const CacheControlHook: ResponseHook = {
  transform(result: unknown, context: ResponseHookContext): unknown {
    context.ctx.set.headers = {
      ...(context.ctx.set.headers ?? {}),
      "cache-control": "public, max-age=30",
    };
    return result;
  },
};
