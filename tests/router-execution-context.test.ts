import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body, Param, Query } from "../src/decorators/params.decorator";
import { UseFilters } from "../src/decorators/use-filters.decorator";
import { Catch } from "../src/decorators/catch.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { Dto, IsString, IsInteger } from "../src/schema";
import type { ExceptionFilter } from "../src/interfaces/exception-filter.interface";

@Dto()
class CreateThingDto {
  @IsString({ minLength: 2 })
  name!: string;
  @IsInteger({ minimum: 0 })
  amount!: number;
}

describe("RouterExecutionContext — param factory wiring", () => {
  test("@Body(Dto), @Param('id'), @Query('q') populate handler args from the request", async () => {
    let captured: any;
    @Controller("things")
    class ThingsController {
      @Post("/:id")
      create(
        @Body(CreateThingDto) body: CreateThingDto,
        @Param("id") id: string,
        @Query("q") q: string,
      ) {
        captured = { body, id, q };
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [ThingsController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/things/abc?q=search-term", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Widget", amount: 7 }),
      }),
    );
    expect(res.status).toBe(200);
    expect(captured).toBeDefined();
    expect(captured.body).toEqual({ name: "Widget", amount: 7 });
    expect(captured.id).toBe("abc");
    expect(captured.q).toBe("search-term");
  });

  test("handler with no params receives no args and runs", async () => {
    let called = 0;
    @Controller("noparams")
    class NoParamsController {
      @Get("/")
      run() {
        called++;
        return { called };
      }
    }
    const app = await TechneFactory.create({
      controllers: [NoParamsController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/noparams"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ called: 1 });
  });
});

describe("RouterExecutionContext — validation rejection", () => {
  test("body that fails DTO validation returns 422 before the handler runs", async () => {
    let handlerRan = false;
    @Controller("validate")
    class ValidateController {
      @Post("/")
      create(@Body(CreateThingDto) _body: CreateThingDto) {
        handlerRan = true;
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [ValidateController],
      logger: false,
    });
    // `name` is too short and `amount` is negative — schema rejects.
    const res = await app.handle(
      new Request("http://localhost/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x", amount: -1 }),
      }),
    );
    expect(res.status).toBe(422);
    expect(handlerRan).toBe(false);
  });
});

describe("RouterExecutionContext — exception filter dispatch", () => {
  test("@UseFilters at handler level sees the thrown exception", async () => {
    let filterSawException: unknown = undefined;

    class CapturingFilter implements ExceptionFilter {
      catch(exception: unknown, host: any) {
        filterSawException = exception;
        host.ctx.set.status = 418;
        return { caught: true };
      }
    }

    @Controller("boom")
    class BoomController {
      @Get("/")
      @UseFilters(new CapturingFilter())
      explode() {
        throw new Error("kaboom");
      }
    }
    const app = await TechneFactory.create({
      controllers: [BoomController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/boom"));
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ caught: true });
    expect(filterSawException).toBeInstanceOf(Error);
    expect((filterSawException as Error).message).toBe("kaboom");
  });

  test("@Catch(SpecificError) filter only catches matching exception types", async () => {
    class MyError extends Error {
      constructor() {
        super("my-error");
        this.name = "MyError";
      }
    }

    @Catch(MyError)
    class MyErrorFilter implements ExceptionFilter {
      catch(_exception: unknown, host: any) {
        host.ctx.set.status = 499;
        return { matched: true };
      }
    }

    @Controller("catch-typed")
    @UseFilters(new MyErrorFilter())
    class TypedController {
      @Get("/match")
      match() {
        throw new MyError();
      }
      @Get("/other")
      other() {
        // Non-matching error type — filter should NOT catch it. Falls through
        // to the default RFC 7807 500-mapper.
        throw new Error("unrelated");
      }
    }
    const app = await TechneFactory.create({
      controllers: [TypedController],
      logger: false,
    });
    const matched = await app.handle(new Request("http://localhost/catch-typed/match"));
    expect(matched.status).toBe(499);
    expect(await matched.json()).toEqual({ matched: true });

    const passthrough = await app.handle(new Request("http://localhost/catch-typed/other"));
    expect(passthrough.status).toBe(500);
  });
});
