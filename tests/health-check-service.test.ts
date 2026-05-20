import { describe, expect, test } from "bun:test";
import { HealthCheckService, type HealthIndicator } from "../src/health/health-check.service";

/**
 * Direct unit tests on `HealthCheckService.check()`. The HTTP-level
 * `/healthz` and `/readyz` paths are covered by `health-endpoints.test.ts`.
 *
 * The real `pingCheck(name)` factory is a stub that always returns `up` (it
 * does not take a URL and does not call `fetch`); `memoryCheck(name, limit)`
 * compares `process.memoryUsage().heapUsed` against the supplied limit.
 * Tests assert against the actual implementation rather than the originally
 * specified (but non-existent) URL/HTTP behavior.
 */
describe("HealthCheckService (unit)", () => {
  test("all indicators healthy → status 'ok' with per-indicator details", async () => {
    const service = new HealthCheckService();
    const indicators: HealthIndicator[] = [
      () => ({ db: { status: "up", latencyMs: 1 } }),
      () => ({ queue: { status: "up" } }),
    ];

    const result = await service.check(indicators);

    expect(result.status).toBe("ok");
    expect(result.info).toEqual({
      db: { status: "up", latencyMs: 1 },
      queue: { status: "up" },
    });
    expect(result.error).toEqual({});
    expect(result.details).toEqual({
      db: { status: "up", latencyMs: 1 },
      queue: { status: "up" },
    });
  });

  test("a non-'up' indicator flips status to 'error' and lands in the error partition", async () => {
    const service = new HealthCheckService();
    const indicators: HealthIndicator[] = [
      () => ({ db: { status: "up" } }),
      () => ({ cache: { status: "down", reason: "connection refused" } }),
    ];

    const result = await service.check(indicators);

    expect(result.status).toBe("error");
    expect(result.info).toEqual({ db: { status: "up" } });
    expect(result.error).toEqual({
      cache: { status: "down", reason: "connection refused" },
    });
    // details holds the merged superset of both partitions.
    expect(result.details.db).toEqual({ status: "up" });
    expect(result.details.cache).toEqual({ status: "down", reason: "connection refused" });
  });

  test("an indicator that throws is recorded as 'down' with its message", async () => {
    const service = new HealthCheckService();

    async function blowsUp() {
      throw new Error("kaboom");
    }
    const indicators: HealthIndicator[] = [() => ({ ok: { status: "up" } }), blowsUp];

    const result = await service.check(indicators);

    expect(result.status).toBe("error");
    expect(result.info).toEqual({ ok: { status: "up" } });
    // The error indicator is keyed by `indicator.name` (function name).
    expect(result.error.blowsUp).toEqual({ status: "down", message: "kaboom" });
  });

  test("anonymous indicator that throws is keyed as 'indicator'", async () => {
    const service = new HealthCheckService();
    // Wrap in an object so the function stays anonymous (no inferred .name).
    const anon = (() => async () => {
      throw new Error("nope");
    })();
    const result = await service.check([anon]);
    expect(result.status).toBe("error");
    expect(result.error.indicator).toEqual({ status: "down", message: "nope" });
  });

  test("mixed healthy + erroring indicators are partitioned correctly", async () => {
    const service = new HealthCheckService();
    const result = await service.check([
      () => ({ a: { status: "up" } }),
      () => ({ b: { status: "down", reason: "x" } }),
      () => ({ c: { status: "up" } }),
    ]);

    expect(result.status).toBe("error");
    expect(Object.keys(result.info).sort()).toEqual(["a", "c"]);
    expect(Object.keys(result.error)).toEqual(["b"]);
  });

  test("empty indicators list → status 'ok' with empty info/error", async () => {
    const service = new HealthCheckService();
    const result = await service.check([]);
    expect(result.status).toBe("ok");
    expect(result.info).toEqual({});
    expect(result.error).toEqual({});
    expect(result.details).toEqual({});
  });

  test("pingCheck(name) factory returns an indicator that reports 'up'", async () => {
    const service = new HealthCheckService();
    const indicator = service.pingCheck("auth-service");
    expect(typeof indicator).toBe("function");

    const result = await service.check([indicator]);
    expect(result.status).toBe("ok");
    expect(result.info["auth-service"]).toEqual({ status: "up" });
  });

  test("memoryCheck reports 'up' when heap is under the limit", async () => {
    const service = new HealthCheckService();
    // Process heap is always non-negative; 1 TiB is comfortably above it.
    const indicator = service.memoryCheck("heap", 1024 ** 4);
    const result = await service.check([indicator]);
    expect(result.status).toBe("ok");
    expect(result.info.heap.status).toBe("up");
    expect(typeof result.info.heap.heapUsed).toBe("number");
  });

  test("memoryCheck reports 'down' when heap exceeds the limit", async () => {
    const service = new HealthCheckService();
    // Limit of 0 bytes — current heap is guaranteed to exceed.
    const indicator = service.memoryCheck("heap", 0);
    const result = await service.check([indicator]);
    expect(result.status).toBe("error");
    expect(result.error.heap.status).toBe("down");
    expect(typeof result.error.heap.heapUsed).toBe("number");
    expect(result.error.heap.heapUsed).toBeGreaterThan(0);
  });
});
