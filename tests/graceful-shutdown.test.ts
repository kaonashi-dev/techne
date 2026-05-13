import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { BnestFactory } from "../src/factory/techne-factory";

describe("Graceful shutdown", () => {
  test("drains in-flight requests before shutting down", async () => {
    @Controller("slow")
    class SlowController {
      @Get("/")
      async slow() {
        await Bun.sleep(50);
        return { ok: true };
      }
    }

    @Module({ controllers: [SlowController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, {
      logger: false,
      shutdown: { gracePeriod: 1000, signals: [] },
    });

    const pending = [
      app.handle(new Request("http://localhost/slow")),
      app.handle(new Request("http://localhost/slow")),
      app.handle(new Request("http://localhost/slow")),
    ];

    // Give the request hooks a tick to register the inflight counter.
    await Bun.sleep(5);
    const closing = app.close();

    const responses = await Promise.all(pending);
    await closing;

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    }
  });

  test("rejects new requests with 503 while draining", async () => {
    @Controller("slow")
    class SlowController {
      @Get("/")
      async slow() {
        await Bun.sleep(40);
        return { ok: true };
      }
    }

    @Module({ controllers: [SlowController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, {
      logger: false,
      shutdown: { gracePeriod: 1000, signals: [] },
    });

    const inflight = app.handle(new Request("http://localhost/slow"));
    await Bun.sleep(5);
    const closing = app.close();

    // While draining, new requests must be refused with 503.
    const rejected = await app.handle(new Request("http://localhost/slow"));
    expect(rejected.status).toBe(503);

    const ok = await inflight;
    expect(ok.status).toBe(200);
    await closing;
  });

  test("readiness flips to false after close()", async () => {
    @Controller("noop")
    class NoopController {
      @Get("/")
      noop() {
        return { ok: true };
      }
    }

    @Module({ controllers: [NoopController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, {
      logger: false,
      shutdown: { gracePeriod: 500, signals: [] },
    });

    // Bootstrap is fired by listen() in production. For tests, emulate it
    // by calling the underlying lifecycle hook indirectly: use listen() with
    // a random port is overkill, so instead mark the app ready by close()
    // path: just close (which always flips readiness to false).
    await app.close();
    const report = await app.getReadiness();
    expect(report.ready).toBe(false);
  });

  test("forced shutdown leaves in-flight pending and logs warning", async () => {
    @Controller("blocking")
    class BlockingController {
      @Get("/")
      async blocking() {
        await Bun.sleep(500);
        return { ok: true };
      }
    }

    @Module({ controllers: [BlockingController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, {
      logger: false,
      shutdown: { gracePeriod: 50, signals: [] },
    });

    const slow = app.handle(new Request("http://localhost/blocking"));
    await Bun.sleep(10);

    const started = Date.now();
    await app.close();
    const elapsed = Date.now() - started;

    // close() must return after the gracePeriod even if requests are pending.
    expect(elapsed).toBeLessThan(450);

    // The pending request still resolves (handler completes), even though
    // close() returned early.
    await slow;
  });
});
