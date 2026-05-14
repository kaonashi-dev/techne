import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Headers, Req } from "../src/decorators/params.decorator";
import { UseFilters } from "../src/decorators/use-filters.decorator";
import { OnResponse } from "../src/decorators/on-response.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import type { ExceptionFilter } from "../src/interfaces/exception-filter.interface";
import type { ResponseHook } from "../src/interfaces/response-hook.interface";
describe("@Headers() decorator", () => {
  test("should extract a specific header", async () => {
    @Controller("headers-test")
    class TestController {
      @Get("/")
      getAuth(
        @Headers("authorization")
        auth: string,
      ) {
        return { auth };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/headers-test", {
        headers: { authorization: "Bearer token123" },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auth: "Bearer token123" });
  });
  test("should extract all headers", async () => {
    @Controller("all-headers")
    class TestController {
      @Get("/")
      getHeaders(
        @Headers()
        headers: any,
      ) {
        return { hasCustom: !!headers["x-custom"] };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/all-headers", {
        headers: { "x-custom": "yes" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasCustom).toBe(true);
  });
});
describe("@Req() decorator", () => {
  test("should inject raw request object", async () => {
    @Controller("req-test")
    class TestController {
      @Get("/")
      getMethod(
        @Req()
        req: Request,
      ) {
        return { method: req.method, url: req.url };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/req-test"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("GET");
    expect(body.url).toContain("/req-test");
  });
});
describe("@UseFilters() decorator", () => {
  test("should use custom exception filter", async () => {
    class CustomFilter implements ExceptionFilter {
      catch(exception: unknown, context: any) {
        context.ctx.set.status = 418;
        return { custom: true, message: "I'm a teapot" };
      }
    }
    @Controller("filter-test")
    @UseFilters(new CustomFilter())
    class TestController {
      @Get("/")
      fail() {
        throw new Error("boom");
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/filter-test"));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ custom: true, message: "I'm a teapot" });
  });
});
describe("@OnResponse() decorator", () => {
  test("should transform handler results", async () => {
    class TimingHook implements ResponseHook {
      transform(result: any) {
        return { ...result, transformed: true };
      }
    }
    @Controller("hook-test")
    @OnResponse(new TimingHook())
    class TestController {
      @Get("/")
      getData() {
        return { data: "hello" };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/hook-test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "hello", transformed: true });
  });
});
describe("TechneApplication", () => {
  test("should provide get() for DI resolution", async () => {
    @Injectable()
    class MyService {
      getValue() {
        return 42;
      }
    }
    const app = await TechneFactory.create({
      providers: [MyService],
      logger: false,
    });
    const service = app.get<MyService>(MyService);
    expect(service.getValue()).toBe(42);
  });
  test("should provide handle() for request handling", async () => {
    @Controller("app-test")
    class TestController {
      @Get("/")
      hello() {
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/app-test"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  test("should expose HTTP adapter", async () => {
    const app = await TechneFactory.create({ logger: false });
    const adapter = app.getHttpAdapter();
    expect(adapter).toBeDefined();
  });
  test("should call onModuleDestroy on close", async () => {
    const events: string[] = [];
    @Injectable()
    class CleanupService {
      onModuleDestroy() {
        events.push("destroyed");
      }
    }
    const app = await TechneFactory.create({
      providers: [CleanupService],
      logger: false,
    });
    await app.close();
    expect(events).toContain("destroyed");
  });
});
