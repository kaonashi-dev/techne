import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { UseFilters } from "../src/decorators/use-filters.decorator";
import { BadRequestException, NotFoundException } from "../src/exceptions";
import { __setIsProduction } from "../src/core/router/router-response-controller";
import { TechneFactory } from "../src/factory/techne-factory";
import type { ExceptionFilter } from "../src/interfaces/exception-filter.interface";

describe("RouterResponseController — RFC 7807 shaping", () => {
  test("HttpException with code+type produces a fully shaped problem document", async () => {
    @Controller("rfc")
    class RfcController {
      @Get("/")
      go() {
        throw new BadRequestException("bad input", {
          code: "input.malformed",
          type: "https://example.com/errors/input-malformed",
        });
      }
    }
    const app = await TechneFactory.create({
      controllers: [RfcController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/rfc"));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(body).toMatchObject({
      type: "https://example.com/errors/input-malformed",
      title: "Bad Request",
      status: 400,
      detail: "bad input",
      code: "input.malformed",
    });
    expect(typeof body.instance).toBe("string");
    expect(body.instance).toBe("/rfc");
  });

  test("HttpException without explicit type derives a slug-based docs URL", async () => {
    @Controller("missing")
    class MissingController {
      @Get("/:id")
      find() {
        throw new NotFoundException("nope");
      }
    }
    const app = await TechneFactory.create({
      controllers: [MissingController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/missing/7"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.type).toBe(
      "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found.md",
    );
    expect(body.detail).toBe("nope");
  });
});

describe("RouterResponseController — production vs dev detail toggle", () => {
  const originalEnv = Bun.env.NODE_ENV;
  const originalIsProduction = originalEnv === "production";

  beforeEach(() => {
    Bun.env.NODE_ENV = originalEnv;
    __setIsProduction(originalIsProduction);
  });
  afterEach(() => {
    Bun.env.NODE_ENV = originalEnv;
    __setIsProduction(originalIsProduction);
  });

  test("production mode hides detail on plain Error 500s", async () => {
    Bun.env.NODE_ENV = "production";
    __setIsProduction(true);

    @Controller("prod-err")
    class ProdErrController {
      @Get("/")
      boom() {
        throw new Error("internal secret detail");
      }
    }
    const app = await TechneFactory.create({
      controllers: [ProdErrController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/prod-err"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).toBe(500);
    expect(body.title).toBe("Internal Server Error");
    expect(body.detail).toBeUndefined();
    // RFC 7807 problem documents never include a JS stack trace — assert it
    // doesn't sneak in through any extension field.
    expect(body.stack).toBeUndefined();
  });

  test("non-production includes detail on 500s", async () => {
    Bun.env.NODE_ENV = "development";
    __setIsProduction(false);

    @Controller("dev-err")
    class DevErrController {
      @Get("/")
      boom() {
        throw new Error("debug-friendly detail");
      }
    }
    const app = await TechneFactory.create({
      controllers: [DevErrController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/dev-err"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBe("debug-friendly detail");
    expect(body.stack).toBeUndefined();
  });
});

describe("RouterResponseController — filter precedence", () => {
  test("route-level @UseFilters beats controller-level @UseFilters beats global filter", async () => {
    class GlobalFilter implements ExceptionFilter {
      catch(_e: unknown, host: any) {
        host.ctx.set.status = 500;
        return { source: "global" };
      }
    }
    class ControllerFilter implements ExceptionFilter {
      catch(_e: unknown, host: any) {
        host.ctx.set.status = 500;
        return { source: "controller" };
      }
    }
    class RouteFilter implements ExceptionFilter {
      catch(_e: unknown, host: any) {
        host.ctx.set.status = 500;
        return { source: "route" };
      }
    }

    @Controller("prec")
    @UseFilters(new ControllerFilter())
    class PrecController {
      @Get("/route-wins")
      @UseFilters(new RouteFilter())
      routeWins() {
        throw new Error("x");
      }

      @Get("/controller-wins")
      controllerWins() {
        throw new Error("x");
      }
    }

    @Controller("plain")
    class PlainController {
      @Get("/")
      go() {
        throw new Error("x");
      }
    }

    const app = await TechneFactory.create({
      controllers: [PrecController, PlainController],
      logger: false,
    });
    // Install a global filter after boot — exec-context recompiles per cache.
    app.useGlobalFilters(new GlobalFilter());

    // Filters dispatch in reverse merge order; the last-registered (route-
    // level) filter sees the error first and short-circuits the others.
    const routeRes = await app.handle(new Request("http://localhost/prec/route-wins"));
    expect(await routeRes.json()).toEqual({ source: "route" });

    // No route filter — controller-level handles it before global.
    const ctrlRes = await app.handle(new Request("http://localhost/prec/controller-wins"));
    expect(await ctrlRes.json()).toEqual({ source: "controller" });

    // No route or controller filter — global handles it.
    const plainRes = await app.handle(new Request("http://localhost/plain"));
    expect(await plainRes.json()).toEqual({ source: "global" });
  });
});
