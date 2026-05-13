import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { TechneFactory } from "../src/factory/techne-factory";

describe("Health endpoints", () => {
  test("/healthz returns 200 immediately after boot", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      shutdown: { signals: [] },
    });

    const response = await app.handle(new Request("http://localhost/healthz"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("/readyz returns 503 before bootstrap and 200 after", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      shutdown: { signals: [] },
    });

    const beforeBootstrap = await app.handle(new Request("http://localhost/readyz"));
    expect(beforeBootstrap.status).toBe(503);
    expect((await beforeBootstrap.json()).status).toBe("not_ready");

    // Boot the app on an ephemeral port to fire onApplicationBootstrap.
    await app.listen(0);

    const afterBootstrap = await app.handle(new Request("http://localhost/readyz"));
    expect(afterBootstrap.status).toBe(200);
    const body = await afterBootstrap.json();
    expect(body.status).toBe("ready");
    expect(Array.isArray(body.checks)).toBe(true);

    await app.close();
  });

  test("custom unhealthy check makes /readyz return 503 with failing check", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      shutdown: { signals: [] },
      health: {
        checks: [
          async () => ({ name: "db", healthy: true, detail: { latencyMs: 1 } }),
          async () => ({ name: "queue", healthy: false, detail: { reason: "disconnected" } }),
        ],
      },
    });

    await app.listen(0);

    const response = await app.handle(new Request("http://localhost/readyz"));
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe("not_ready");
    expect(body.checks).toEqual([
      { name: "db", healthy: true, detail: { latencyMs: 1 } },
      { name: "queue", healthy: false, detail: { reason: "disconnected" } },
    ]);

    await app.close();
  });

  test("custom paths override defaults", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      shutdown: { signals: [] },
      health: {
        livenessPath: "/live",
        readinessPath: "/ready",
      },
    });

    const live = await app.handle(new Request("http://localhost/live"));
    expect(live.status).toBe(200);

    const defaultLive = await app.handle(new Request("http://localhost/healthz"));
    expect(defaultLive.status).toBe(404);
  });

  test("can be disabled entirely", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      shutdown: { signals: [] },
      health: { enabled: false },
    });

    const live = await app.handle(new Request("http://localhost/healthz"));
    expect(live.status).toBe(404);
  });
});
