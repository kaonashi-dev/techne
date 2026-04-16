import type { MqConnectionOptions, RedisClientAdapter } from "../types";

function coerceNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}

function normalizeBlpopResult(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const candidate = value.at(-1);
    return typeof candidate === "string" ? candidate : null;
  }
  if (value && typeof value === "object" && "element" in value) {
    const element = (value as { element?: unknown }).element;
    return typeof element === "string" ? element : null;
  }
  return null;
}

async function maybeQuit(client: unknown): Promise<void> {
  if (client && typeof (client as { quit?: () => Promise<void> | void }).quit === "function") {
    await (client as { quit: () => Promise<void> | void }).quit();
  }
}

function createRawRedisClient(
  options: MqConnectionOptions,
  kind: "client" | "subscriber",
): unknown {
  if (kind === "client") {
    return (
      options.client ??
      options.clientFactory?.() ??
      (Bun as typeof Bun & { redis?: (url: string) => unknown }).redis?.(
        options.url || "redis://127.0.0.1:6379",
      )
    );
  }

  return (
    options.subscriber ??
    options.subscriberFactory?.() ??
    (options.client &&
      typeof (options.client as { duplicate?: () => unknown }).duplicate === "function" &&
      (options.client as { duplicate: () => unknown }).duplicate()) ??
    (Bun as typeof Bun & { redis?: (url: string) => unknown }).redis?.(
      options.url || "redis://127.0.0.1:6379",
    )
  );
}

export function createRedisClientAdapter(
  options: MqConnectionOptions = {},
  kind: "client" | "subscriber" = "client",
): RedisClientAdapter {
  const client = createRawRedisClient(options, kind) as
    | Record<string, (...args: unknown[]) => unknown>
    | undefined;

  if (!client) {
    throw new Error("Redis client is not available in this Bun runtime");
  }

  return {
    async get(key: string) {
      const result = await client.get?.(key);
      return typeof result === "string" ? result : result == null ? null : String(result);
    },
    async set(key: string, value: string) {
      return await client.set?.(key, value);
    },
    async del(...keys: string[]) {
      return await client.del?.(...keys);
    },
    async rpush(key: string, ...values: string[]) {
      return await client.rpush?.(key, ...values);
    },
    async lpush(key: string, ...values: string[]) {
      return await client.lpush?.(key, ...values);
    },
    async lpop(key: string) {
      const result = await client.lpop?.(key);
      return typeof result === "string" ? result : result == null ? null : String(result);
    },
    async llen(key: string) {
      return coerceNumber(await client.llen?.(key));
    },
    async blpop(key: string, timeoutSeconds: number) {
      const result = await client.blpop?.(key, timeoutSeconds);
      return normalizeBlpopResult(result);
    },
    async zadd(key: string, score: number, member: string) {
      return await client.zadd?.(key, score, member);
    },
    async zrem(key: string, member: string) {
      return await client.zrem?.(key, member);
    },
    async zcard(key: string) {
      return coerceNumber(await client.zcard?.(key));
    },
    async zrangebyscore(key: string, min: number, max: number) {
      const result = await client.zrangebyscore?.(key, min, max);
      return Array.isArray(result) ? result.map((item) => String(item)) : [];
    },
    async zrange(key: string, start: number, stop: number, withScores = false) {
      const result = withScores
        ? await client.zrange?.(key, start, stop, "WITHSCORES")
        : await client.zrange?.(key, start, stop);
      return Array.isArray(result) ? result.map((item) => String(item)) : [];
    },
    async publish(channel: string, message: string) {
      return await client.publish?.(channel, message);
    },
    async subscribe(channel: string, listener: (message: string) => void) {
      if (typeof client.subscribe !== "function") {
        throw new Error("Redis subscriber does not support subscribe()");
      }

      const raw = client as {
        subscribe: (...args: unknown[]) => unknown;
        unsubscribe?: (...args: unknown[]) => unknown;
      };

      await raw.subscribe(channel, (message: unknown) => {
        if (typeof message === "string") {
          listener(message);
          return;
        }

        if (message && typeof message === "object" && "message" in message) {
          const payload = (message as { message?: unknown }).message;
          if (typeof payload === "string") {
            listener(payload);
          }
        }
      });

      return async () => {
        await raw.unsubscribe?.(channel);
        if (kind === "subscriber") {
          await maybeQuit(raw);
        }
      };
    },
    async quit() {
      await maybeQuit(client);
    },
  };
}
