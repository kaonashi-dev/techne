import { test, expect, describe } from "bun:test";
import { Elysia } from "elysia";
import { BnestFactory } from "../src/factory/techne-factory";
import { definePlugin } from "../src/core/plugins/define-plugin";
import type { PluginDefinition } from "../src/core/plugins/define-plugin";
import { requestIdPlugin } from "../src/core/plugins/built-in/request-id.plugin";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";

@Module({})
class EmptyModule {}

describe("Plugin protocol", () => {
  test("definePlugin is an identity function", () => {
    const def: PluginDefinition = { name: "p", setup: () => {} };
    expect(definePlugin(def)).toBe(def);
  });

  test("register() invokes setup once with a populated context", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });
    let calls = 0;
    let captured: any;

    const plugin = definePlugin({
      name: "ctx-probe",
      setup(ctx) {
        calls++;
        captured = ctx;
      },
    });

    await app.register(plugin);
    await app.close();

    expect(calls).toBe(1);
    expect(captured.app).toBeDefined();
    expect(captured.options).toBeDefined();
    expect(typeof captured.provide).toBe("function");
    expect(typeof captured.resolve).toBe("function");
    expect(typeof captured.onReady).toBe("function");
    expect(typeof captured.onShutdown).toBe("function");
    expect(typeof captured.http).toBe("function");
    expect(captured.http()).toBeDefined();
    expect(captured.logger).toBeDefined();
  });

  test("provide() makes a value resolvable via app.get()", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });
    const TOKEN = Symbol("CACHE_CLIENT");
    const value = { ping: () => "pong" };

    const plugin = definePlugin({
      name: "cache",
      setup(ctx) {
        ctx.provide(TOKEN, value);
      },
    });

    await app.register(plugin);
    expect(app.get(TOKEN)).toBe(value);
    expect((app.get(TOKEN) as any).ping()).toBe("pong");
    await app.close();
  });

  test("options are a frozen view of BnestFactory.create options", async () => {
    const app = await BnestFactory.create(EmptyModule, {
      logger: false,
      globalPrefix: "api",
    });
    let seen: any;

    await app.register(
      definePlugin({
        name: "opts",
        setup(ctx) {
          seen = ctx.options;
        },
      }),
    );

    expect(seen.globalPrefix).toBe("api");
    expect(Object.isFrozen(seen)).toBe(true);
    await app.close();
  });

  test("onReady fires after onApplicationBootstrap and before listen returns", async () => {
    const events: string[] = [];

    @Injectable()
    class BootstrapService {
      onApplicationBootstrap() {
        events.push("bootstrap");
      }
    }

    @Module({ providers: [BootstrapService] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    await app.register(
      definePlugin({
        name: "ready-probe",
        setup(ctx) {
          ctx.onReady(() => {
            events.push("ready");
          });
        },
      }),
    );

    // Pick a high port that's unlikely to collide.
    await app.listen(0, () => {
      events.push("listen-callback");
    });

    expect(events).toEqual(["bootstrap", "ready", "listen-callback"]);
    await app.close();
  });

  test("onShutdown handlers fire in reverse registration order on close()", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });
    const order: string[] = [];

    await app.register(
      definePlugin({
        name: "shutdown-a",
        setup(ctx) {
          ctx.onShutdown(() => {
            order.push("a");
          });
        },
      }),
    );
    await app.register(
      definePlugin({
        name: "shutdown-b",
        setup(ctx) {
          ctx.onShutdown(async () => {
            await Promise.resolve();
            order.push("b");
          });
        },
      }),
    );
    await app.register(
      definePlugin({
        name: "shutdown-c",
        setup(ctx) {
          ctx.onShutdown(() => {
            order.push("c");
          });
        },
      }),
    );

    await app.close();
    expect(order).toEqual(["c", "b", "a"]);
  });

  test("dependency check throws when a named dependency is missing", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });

    const dependent = definePlugin({
      name: "needs-base",
      dependencies: ["base"],
      setup: () => {},
    });

    await expect(app.register(dependent)).rejects.toThrow(/depends on "base"/);

    const base = definePlugin({ name: "base", setup: () => {} });
    await app.register(base);
    await app.register(dependent);

    expect(app.getRegisteredPlugins()).toEqual(["base", "needs-base"]);
    await app.close();
  });

  test("registering the same plugin name with a different setup throws", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });
    await app.register(definePlugin({ name: "dup", setup: () => {} }));
    await expect(
      app.register(definePlugin({ name: "dup", setup: () => {} })),
    ).rejects.toThrow(/already registered/);
    await app.close();
  });

  test("registering the exact same plugin twice is a no-op", async () => {
    const app = await BnestFactory.create(EmptyModule, { logger: false });
    let calls = 0;
    const plugin = definePlugin({
      name: "idem",
      setup: () => {
        calls++;
      },
    });
    await app.register(plugin);
    await app.register(plugin);
    expect(calls).toBe(1);
    await app.close();
  });

  test("app.use() composes a native Elysia plugin and its routes are handled", async () => {
    @Controller("/")
    class RootController {
      @Get("/root")
      root() {
        return { ok: true };
      }
    }

    @Module({ controllers: [RootController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const elysiaPlugin = new Elysia().get("/plugin-route", () => ({ from: "plugin" }));

    expect(() => app.use(elysiaPlugin)).not.toThrow();

    const res = await app.handle(new Request("http://localhost/plugin-route"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: "plugin" });

    // Bnest-registered routes should still work after `use()`.
    const rootRes = await app.handle(new Request("http://localhost/root"));
    expect(rootRes.status).toBe(200);

    await app.close();
  });

  test("built-in request-id plugin registers without breaking existing flow", async () => {
    @Controller("/")
    class HelloController {
      @Get("/hello")
      hello() {
        return { ok: true };
      }
    }

    @Module({ controllers: [HelloController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    await app.register(requestIdPlugin, { header: "x-trace-id" });

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    // The adapter echoes the request-id header back regardless of plugin —
    // the assertion here is that the plugin doesn't break that behavior.
    expect(res.headers.get("x-request-id")).toBeTruthy();

    await app.close();
  });
});
