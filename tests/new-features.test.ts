import { describe, expect, test } from "bun:test";
import { BnestFactory } from "../src/factory/bnest-factory";
import { Module } from "../src/decorators/module.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body, Headers, Param, Req } from "../src/decorators/params.decorator";
import { UseFilters } from "../src/decorators/use-filters.decorator";
import { UseInterceptors } from "../src/decorators/use-interceptors.decorator";
import { UsePipes } from "../src/decorators/use-pipes.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { NotFoundException } from "../src/exceptions";
import type { ExceptionFilter } from "../src/interfaces/exception-filter.interface";
import type { BnestInterceptor, CallHandler } from "../src/interfaces/interceptor.interface";
import type { PipeTransform, ArgumentMetadata } from "../src/interfaces/pipe-transform.interface";

describe("@Headers() decorator", () => {
  test("should extract a specific header", async () => {
    @Controller("headers-test")
    class TestController {
      @Get("/")
      getAuth(@Headers("authorization") auth: string) {
        return { auth };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
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
      getHeaders(@Headers() headers: any) {
        return { hasCustom: !!headers["x-custom"] };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
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
      getMethod(@Req() req: Request) {
        return { method: req.method, url: req.url };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
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
        context.set.status = 418;
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

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/filter-test"));

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ custom: true, message: "I'm a teapot" });
  });
});

describe("@UseInterceptors() decorator", () => {
  test("should wrap handler with interceptor", async () => {
    class TimingInterceptor implements BnestInterceptor {
      async intercept(context: any, next: CallHandler) {
        const result = await next.handle();
        return { ...result, intercepted: true };
      }
    }

    @Controller("intercept-test")
    @UseInterceptors(new TimingInterceptor())
    class TestController {
      @Get("/")
      getData() {
        return { data: "hello" };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/intercept-test"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "hello", intercepted: true });
  });
});

describe("@UsePipes() decorator", () => {
  test("should transform params with pipe", async () => {
    class UpperCasePipe implements PipeTransform {
      transform(value: any, metadata: ArgumentMetadata) {
        return typeof value === "string" ? value.toUpperCase() : value;
      }
    }

    @Controller("pipe-test")
    @UsePipes(new UpperCasePipe())
    class TestController {
      @Get("/:name")
      greet(@Param("name") name: string) {
        return { name };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/pipe-test/alice"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "ALICE" });
  });
});

describe("BnestApplication", () => {
  test("should provide get() for DI resolution", async () => {
    @Injectable()
    class MyService {
      getValue() {
        return 42;
      }
    }

    @Module({ providers: [MyService] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
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

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/app-test"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("should expose HTTP adapter", async () => {
    @Module({})
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
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

    @Module({ providers: [CleanupService] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    await app.close();

    expect(events).toContain("destroyed");
  });
});
