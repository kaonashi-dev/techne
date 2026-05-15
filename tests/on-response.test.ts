import { describe, expect, test } from "bun:test";
import { REQUEST } from "../src/common/constants";
import { Controller } from "../src/decorators/controller.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Inject } from "../src/decorators/inject.decorator";
import { OnResponse } from "../src/decorators/on-response.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import type { ResponseHook, ResponseHookContext } from "../src/interfaces/response-hook.interface";

describe("@OnResponse()", () => {
  test("composes response hooks left to right", async () => {
    class FirstHook implements ResponseHook {
      transform(result: any) {
        return { ...result, order: ["first"] };
      }
    }

    class SecondHook implements ResponseHook {
      transform(result: any) {
        return { ...result, order: [...result.order, "second"] };
      }
    }

    @Controller("on-response-order")
    @OnResponse(new FirstHook(), new SecondHook())
    class TestController {
      @Get("/")
      getData() {
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [TestController],
      logger: false,
    });

    const response = await app.handle(new Request("http://localhost/on-response-order"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, order: ["first", "second"] });
  });

  test("resolves DI-aware hook classes", async () => {
    @Injectable()
    class TraceService {
      value() {
        return "di-hook";
      }
    }

    @Injectable()
    class TraceHook implements ResponseHook {
      constructor(private readonly trace: TraceService) {}

      transform(result: any, context: ResponseHookContext) {
        return {
          ...result,
          trace: this.trace.value(),
          controller: context.controller.name,
        };
      }
    }

    @Controller("on-response-di")
    @OnResponse(TraceHook)
    class TestController {
      @Get("/")
      getData() {
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [TestController],
      providers: [TraceService, TraceHook],
      logger: false,
    });

    const response = await app.handle(new Request("http://localhost/on-response-di"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      trace: "di-hook",
      controller: "TestController",
    });
  });

  test("passes request identity to contextual hooks", async () => {
    @Injectable()
    class RequestIdHook implements ResponseHook {
      constructor(@Inject(REQUEST) private readonly requestContext: any) {}

      transform(result: any) {
        return {
          ...result,
          path: new URL(this.requestContext.request.url).pathname,
        };
      }
    }

    @Controller("on-response-request")
    @OnResponse(RequestIdHook)
    class TestController {
      @Get("/")
      getData() {
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [TestController],
      providers: [RequestIdHook],
      logger: false,
    });

    const response = await app.handle(new Request("http://localhost/on-response-request"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, path: "/on-response-request" });
  });
});
