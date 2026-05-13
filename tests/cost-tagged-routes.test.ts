import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { UseGuards } from "../src/decorators/use-guards.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { BnestFactory } from "../src/factory/bnest-factory";

describe("Cost-tagged routes", () => {
  test("route with no enhancers and no request-scoped deps responds 200", async () => {
    @Injectable()
    class GreetService {
      hello() {
        return { msg: "hello" };
      }
    }

    @Controller("g")
    class GreetController {
      constructor(private readonly svc: GreetService) {}
      @Get("/hello")
      h() {
        return this.svc.hello();
      }
    }

    @Module({ controllers: [GreetController], providers: [GreetService] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/g/hello"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ msg: "hello" });
  });

  test("static guard is hoisted: instance constructed once across requests", async () => {
    let constructions = 0;
    let activations = 0;

    @Injectable()
    class CountingGuard {
      constructor() {
        constructions++;
      }
      canActivate(_ctx: any) {
        activations++;
        return true;
      }
    }

    @Controller("counted")
    @UseGuards(CountingGuard)
    class CountedController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }

    @Module({
      controllers: [CountedController],
      providers: [CountingGuard],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    for (let i = 0; i < 3; i++) {
      const res = await app.handle(new Request("http://localhost/counted"));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }

    // Static guard is resolved once at boot, then captured in the closure.
    expect(constructions).toBe(1);
    // canActivate must still run once per request.
    expect(activations).toBe(3);
  });

  test("static guard that denies returns 403 each time and runs once per request", async () => {
    let activations = 0;

    @Injectable()
    class DenyGuard {
      canActivate(_ctx: any) {
        activations++;
        return false;
      }
    }

    @Controller("deny")
    @UseGuards(DenyGuard)
    class DenyController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }

    @Module({ controllers: [DenyController], providers: [DenyGuard] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    for (let i = 0; i < 3; i++) {
      const res = await app.handle(new Request("http://localhost/deny"));
      expect(res.status).toBe(403);
    }
    expect(activations).toBe(3);
  });
});
