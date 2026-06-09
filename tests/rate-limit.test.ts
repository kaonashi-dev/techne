import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { RateLimit } from "../src/decorators/rate-limit.decorator";
import { InMemoryTokenBucketStore } from "../src/security/rate-limit";

// ---------------------------------------------------------------------------
// Shared test controllers — defined at module scope so decorator metadata is
// applied only once (class decorators are not re-applied per-test).
// ---------------------------------------------------------------------------

@Controller("items")
class ItemsController {
  @Get("/")
  list() {
    return { items: [] };
  }
}

@Controller("override")
class OverrideController {
  @RateLimit({ limit: 3, windowMs: 60_000 })
  @Get("/")
  tightEndpoint() {
    return { ok: true };
  }
}

@Controller("exempt")
class ExemptController {
  @RateLimit(false)
  @Get("/")
  publicEndpoint() {
    return { public: true };
  }
}

// ---------------------------------------------------------------------------
// 1. InMemoryTokenBucketStore unit tests
// ---------------------------------------------------------------------------

describe("InMemoryTokenBucketStore", () => {
  test("first request at capacity — remaining = limit - 1", () => {
    const store = new InMemoryTokenBucketStore();
    const policy = { limit: 10, windowMs: 60_000, burst: 10 };
    const decision = store.consume("key1", policy) as any;
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(9);
    expect(decision.limit).toBe(10);
  });

  test("exhausting all tokens — last request denied", () => {
    const store = new InMemoryTokenBucketStore();
    const policy = { limit: 3, windowMs: 60_000, burst: 3 };
    // Drain all 3 tokens
    for (let i = 0; i < 3; i++) {
      const d = store.consume("k", policy) as any;
      expect(d.allowed).toBe(true);
    }
    // 4th request should be denied
    const denied = store.consume("k", policy) as any;
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  test("different keys are isolated", () => {
    const store = new InMemoryTokenBucketStore();
    const policy = { limit: 1, windowMs: 60_000, burst: 1 };
    const a = store.consume("a", policy) as any;
    const b = store.consume("b", policy) as any;
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });

  test("bucket refills after time advances past windowMs", () => {
    const store = new InMemoryTokenBucketStore();
    const policy = { limit: 5, windowMs: 1_000, burst: 5 };

    // Drain all tokens
    for (let i = 0; i < 5; i++) {
      store.consume("key", policy);
    }
    const denied = store.consume("key", policy) as any;
    expect(denied.allowed).toBe(false);

    // Mock Date.now to be 2 seconds in the future (double the window)
    const realNow = Date.now;
    const future = realNow() + 2_000;
    const spy = spyOn(Date, "now").mockReturnValue(future);
    try {
      const refilled = store.consume("key", policy) as any;
      expect(refilled.allowed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("burst > limit: can burst above per-window limit", () => {
    const store = new InMemoryTokenBucketStore();
    // burst=10 means the bucket starts at 10 tokens even though limit=5
    const policy = { limit: 5, windowMs: 60_000, burst: 10 };
    // Should allow 10 requests before denying (burst capacity)
    let allowed = 0;
    for (let i = 0; i < 12; i++) {
      const d = store.consume("burst-key", policy) as any;
      if (d.allowed) allowed++;
    }
    expect(allowed).toBe(10);
  });

  test("resetMs is a future epoch ms value", () => {
    const store = new InMemoryTokenBucketStore();
    const policy = { limit: 1, windowMs: 60_000, burst: 1 };
    store.consume("k", policy); // drain
    const denied = store.consume("k", policy) as any;
    expect(denied.resetMs).toBeGreaterThan(Date.now());
  });
});

// ---------------------------------------------------------------------------
// 2. Global rate limiter integration tests
// ---------------------------------------------------------------------------

describe("global rate limiter — integration", () => {
  test("hit limit+1 times — last returns 429", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 5,
        windowMs: 60_000,
        store,
        keyExtractor: () => "test-client",
      },
    });

    // First 5 requests should succeed
    for (let i = 0; i < 5; i++) {
      const res = await app.handle(new Request("http://localhost/items"));
      expect(res.status).toBe(200);
    }
    // 6th should be rate-limited
    const blocked = await app.handle(new Request("http://localhost/items"));
    expect(blocked.status).toBe(429);
  });

  test("429 response has content-type: application/problem+json", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: () => "ct-test",
      },
    });
    await app.handle(new Request("http://localhost/items")); // consume token
    const blocked = await app.handle(new Request("http://localhost/items"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("content-type")).toContain("application/problem+json");
  });

  test("429 response body is valid RFC 7807 problem document", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: () => "body-test",
      },
    });
    await app.handle(new Request("http://localhost/items")); // consume token
    const blocked = await app.handle(new Request("http://localhost/items"));
    const body = await blocked.json() as any;
    expect(body.type).toBe("https://techne.dev/errors/too-many-requests");
    expect(body.title).toBe("Too Many Requests");
    expect(body.status).toBe(429);
    expect(typeof body.detail).toBe("string");
  });

  test("429 has retry-after header", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: () => "retry-test",
      },
    });
    await app.handle(new Request("http://localhost/items")); // consume token
    const blocked = await app.handle(new Request("http://localhost/items"));
    const retryAfter = blocked.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  test("429 has ratelimit-limit, ratelimit-remaining: 0, ratelimit-reset headers", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 2,
        windowMs: 60_000,
        store,
        headers: true,
        keyExtractor: () => "headers-test",
      },
    });
    await app.handle(new Request("http://localhost/items"));
    await app.handle(new Request("http://localhost/items")); // consume last token
    const blocked = await app.handle(new Request("http://localhost/items"));
    expect(blocked.headers.get("ratelimit-limit")).toBe("2");
    expect(blocked.headers.get("ratelimit-remaining")).toBe("0");
    const reset = blocked.headers.get("ratelimit-reset");
    expect(reset).not.toBeNull();
    expect(Number(reset)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  test("success response has ratelimit-remaining header when headers: true", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
        store,
        headers: true,
        keyExtractor: () => "success-headers-test",
      },
    });
    const res = await app.handle(new Request("http://localhost/items"));
    expect(res.status).toBe(200);
    const remaining = res.headers.get("ratelimit-remaining");
    expect(remaining).not.toBeNull();
    expect(Number(remaining)).toBeGreaterThanOrEqual(0);
    expect(res.headers.get("ratelimit-limit")).toBe("10");
  });

  test("no rate limit headers when headers: false", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 10,
        windowMs: 60_000,
        store,
        headers: false,
        keyExtractor: () => "no-headers-test",
      },
    });
    const res = await app.handle(new Request("http://localhost/items"));
    expect(res.headers.get("ratelimit-remaining")).toBeNull();
    expect(res.headers.get("ratelimit-limit")).toBeNull();
  });

  test("excluded paths bypass the limiter", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: () => "exclude-test",
        exclude: ["/items"],
      },
    });
    // First request should succeed (path excluded)
    await app.handle(new Request("http://localhost/items"));
    // Even after "exhausting" the limit, excluded path keeps working
    const res = await app.handle(new Request("http://localhost/items"));
    expect(res.status).toBe(200);
  });

  test("different keys get independent limits", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: (ctx: any) => ctx.request.headers.get("x-client-id") ?? "default",
      },
    });
    // Client A exhausts its limit
    await app.handle(new Request("http://localhost/items", { headers: { "x-client-id": "a" } }));
    const blocked = await app.handle(
      new Request("http://localhost/items", { headers: { "x-client-id": "a" } }),
    );
    expect(blocked.status).toBe(429);

    // Client B should still be allowed
    const allowed = await app.handle(
      new Request("http://localhost/items", { headers: { "x-client-id": "b" } }),
    );
    expect(allowed.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 3. Zero-cost contract: no rateLimit option → no rate-limit headers
// ---------------------------------------------------------------------------

describe("zero-cost contract", () => {
  test("no rateLimit option — no ratelimit headers on success", async () => {
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/items"));
    expect(res.status).toBe(200);
    expect(res.headers.get("ratelimit-remaining")).toBeNull();
    expect(res.headers.get("ratelimit-limit")).toBeNull();
    expect(res.headers.get("ratelimit-reset")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. @RateLimit decorator tests
// ---------------------------------------------------------------------------

describe("@RateLimit decorator", () => {
  test("@RateLimit({ limit: 3 }) on handler applies a tighter per-route limit", async () => {
    const store = new InMemoryTokenBucketStore();
    // Global limit is 100 — won't interfere
    const app = await TechneFactory.create({
      controllers: [OverrideController],
      logger: false,
      rateLimit: {
        limit: 100,
        windowMs: 60_000,
        store,
        keyExtractor: () => "override-test",
      },
    });

    // Per-route limit is 3 — exhaust it
    for (let i = 0; i < 3; i++) {
      const res = await app.handle(new Request("http://localhost/override"));
      expect(res.status).toBe(200);
    }
    // 4th request should be blocked by the per-route limiter
    const blocked = await app.handle(new Request("http://localhost/override"));
    expect(blocked.status).toBe(429);
  });

  test("@RateLimit(false) exempts a route from the global limiter", async () => {
    const store = new InMemoryTokenBucketStore();
    // Global limit of 1 — but the exempt route should still work
    const app = await TechneFactory.create({
      controllers: [ItemsController, ExemptController],
      logger: false,
      rateLimit: {
        limit: 1,
        windowMs: 60_000,
        store,
        keyExtractor: () => "exempt-test",
      },
    });

    // Exhaust global limit on the non-exempt route
    await app.handle(new Request("http://localhost/items"));
    const blocked = await app.handle(new Request("http://localhost/items"));
    expect(blocked.status).toBe(429);

    // Exempt route should still be accessible
    const exemptRes = await app.handle(new Request("http://localhost/exempt"));
    expect(exemptRes.status).toBe(200);
  });

  test("@RateLimit(false) route returns 200 even when global limit is exhausted", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = await TechneFactory.create({
      controllers: [ExemptController],
      logger: false,
      rateLimit: {
        limit: 0,
        windowMs: 60_000,
        // Override with a store that always denies
        store: {
          consume: (_key: string, policy: any) => ({
            allowed: false,
            remaining: 0,
            resetMs: Date.now() + 60_000,
            limit: policy.limit,
          }),
        },
        keyExtractor: () => "always-deny",
      },
    });

    // The exempt path should bypass the limiter entirely
    const res = await app.handle(new Request("http://localhost/exempt"));
    expect(res.status).toBe(200);
  });
});
