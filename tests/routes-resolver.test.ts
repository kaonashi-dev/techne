import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Version } from "../src/decorators/version.decorator";
import { TechneFactory } from "../src/factory/techne-factory";

describe("RoutesResolver — global prefix", () => {
  test("globalPrefix in config mounts every controller route under the prefix", async () => {
    @Controller("users")
    class UsersController {
      @Get("/")
      list() {
        return { ok: true };
      }
      @Get("/:id")
      one() {
        return { one: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
      globalPrefix: "api",
    });

    const list = await app.handle(new Request("http://localhost/api/users"));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ ok: true });

    const one = await app.handle(new Request("http://localhost/api/users/42"));
    expect(one.status).toBe(200);
    expect(await one.json()).toEqual({ one: true });

    // Without the prefix the routes are NOT mounted (404 / no match).
    const bare = await app.handle(new Request("http://localhost/users"));
    expect(bare.status).not.toBe(200);
  });

  test("globalPrefix with leading/trailing slashes is normalized", async () => {
    @Controller("items")
    class ItemsController {
      @Get("/")
      list() {
        return { items: [] };
      }
    }
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      globalPrefix: "/v1/",
    });
    const res = await app.handle(new Request("http://localhost/v1/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  test("empty globalPrefix string is treated as no prefix", async () => {
    @Controller("ping")
    class PingController {
      @Get("/")
      ping() {
        return { pong: true };
      }
    }
    // applyGlobalPrefix short-circuits when prefix is falsy ("" is falsy).
    const app = await TechneFactory.create({
      controllers: [PingController],
      logger: false,
      globalPrefix: "",
    });
    const res = await app.handle(new Request("http://localhost/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  test("globalPrefix exclude list keeps the excluded route at its original path", async () => {
    @Controller("health")
    class HealthController {
      @Get("/")
      check() {
        return { healthy: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [HealthController],
      logger: false,
      globalPrefix: "api",
      globalPrefixOptions: { exclude: ["/health"] },
    });
    const direct = await app.handle(new Request("http://localhost/health"));
    expect(direct.status).toBe(200);
    expect(await direct.json()).toEqual({ healthy: true });
  });
});

describe("RoutesResolver — route expansion", () => {
  test("expands multiple methods on multiple controllers", async () => {
    @Controller("a")
    class A {
      @Get("/x")
      x() {
        return { who: "a-x" };
      }
      @Get("/y")
      y() {
        return { who: "a-y" };
      }
    }
    @Controller("b")
    class B {
      @Get("/x")
      x() {
        return { who: "b-x" };
      }
    }
    const app = await TechneFactory.create({
      controllers: [A, B],
      logger: false,
    });
    const routes = app.getRoutes();
    const paths = routes.map((r: any) => r.fullPath).sort();
    expect(paths).toContain("/a/x");
    expect(paths).toContain("/a/y");
    expect(paths).toContain("/b/x");

    const ax = await app.handle(new Request("http://localhost/a/x"));
    expect(await ax.json()).toEqual({ who: "a-x" });
    const ay = await app.handle(new Request("http://localhost/a/y"));
    expect(await ay.json()).toEqual({ who: "a-y" });
    const bx = await app.handle(new Request("http://localhost/b/x"));
    expect(await bx.json()).toEqual({ who: "b-x" });
  });
});

describe("RoutesResolver — versioning", () => {
  test("@Version on a handler lands at the versioned path under URI versioning", async () => {
    @Controller("books")
    class BooksController {
      @Version("1")
      @Get("/")
      v1() {
        return { v: 1 };
      }
      @Get("/")
      unversioned() {
        return { v: "none" };
      }
    }
    const app = await TechneFactory.create({
      controllers: [BooksController],
      logger: false,
      versioning: { type: "uri" },
    });
    const v1 = await app.handle(new Request("http://localhost/v1/books"));
    expect(v1.status).toBe(200);
    expect(await v1.json()).toEqual({ v: 1 });

    // Unversioned handler still reachable at the un-prefixed path (the
    // versioning loop only versions handlers that declare a version).
    const bare = await app.handle(new Request("http://localhost/books"));
    expect(bare.status).toBe(200);
  });

  test("URI versioning honors a custom prefix", async () => {
    @Controller("items")
    class ItemsController {
      @Version("2")
      @Get("/")
      list() {
        return { v: 2 };
      }
    }
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
      versioning: { type: "uri", prefix: "api/v" },
    });
    const res = await app.handle(new Request("http://localhost/api/v2/items"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ v: 2 });
  });
});

describe("RoutesResolver — duplicate route handling", () => {
  test("two controllers declaring the same path do not throw at boot", async () => {
    // The resolver doesn't proactively detect duplicates; it hands every
    // expanded route to the adapter in declaration order. Verify boot
    // succeeds and the route is resolvable — the documented contract here is
    // "no crash"; Elysia decides the winner.
    @Controller("dup")
    class First {
      @Get("/")
      first() {
        return { who: "first" };
      }
    }
    @Controller("dup")
    class Second {
      @Get("/")
      second() {
        return { who: "second" };
      }
    }
    const app = await TechneFactory.create({
      controllers: [First, Second],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/dup"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Either "first" or "second" depending on adapter ordering — assert one
    // of the two without pinning down which (last-wins is not contractual).
    expect(["first", "second"]).toContain(body.who);
  });
});
