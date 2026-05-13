/**
 * Regression tests for the Batch 3 perf fixes.
 *
 *   1. `maybeStringify` reuses cached `ResponseInit` for status=200 and
 *      sets the correct content-type. We can't observe the constant identity
 *      from outside, but we can observe that the typed route emits a JSON
 *      body with the right `content-type` and a serialized payload.
 *
 *   2. `ValidationPipe` throws a `LazyValidationException` that:
 *        - extends `BadRequestException`
 *        - exposes a `.lazyErrors()` accessor returning the FULL error list
 *
 *   3. The `x-request-id` response header is still echoed when the framework
 *      logger is enabled (default) — this guards the request-id optimization
 *      from accidentally regressing.
 */
import { describe, expect, test } from "bun:test";
import { BnestFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body } from "../src/decorators/params.decorator";
import { Module } from "../src/decorators/module.decorator";
import { LazyValidationException, ValidationPipe } from "../src/pipes";
import { BadRequestException } from "../src/exceptions";
import { Dto, IsNumber, IsString, Schema } from "../src/schema";

describe("Batch 3 perf-fix regressions", () => {
  test("typed-response route emits JSON body with content-type application/json", async () => {
    const UserSchema = Schema.Object({
      id: Schema.Number(),
      name: Schema.String(),
    });

    @Controller("typed")
    class TypedController {
      @Get("/user", { response: UserSchema })
      get() {
        return { id: 1, name: "Alice" };
      }
    }

    @Module({ controllers: [TypedController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/typed/user"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ id: 1, name: "Alice" });
  });

  test("invalid body throws LazyValidationException with lazyErrors() accessor", () => {
    @Dto()
    class CreateUserDto {
      @IsString({ minLength: 2 })
      name!: string;

      @IsNumber({ minimum: 0 })
      age!: number;
    }

    const pipe = new ValidationPipe();
    let caught: unknown;
    try {
      pipe.transform({ name: "A" }, { type: "body", metatype: CreateUserDto });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught).toBeInstanceOf(LazyValidationException);

    const lazy = caught as LazyValidationException;
    const all = lazy.lazyErrors();
    expect(Array.isArray(all)).toBe(true);
    // Both `name` (minLength) and `age` (required) should surface in the
    // lazy enumeration. The eager throw-path only materialized the first.
    const properties = all.map((entry) => entry.property);
    expect(properties).toContain("name");
    expect(properties).toContain("age");

    // Cached on subsequent calls — same reference.
    expect(lazy.lazyErrors()).toBe(all);
  });

  test("request-id is echoed when the logger is enabled (default)", async () => {
    @Controller("echo-logged")
    class EchoController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }

    @Module({ controllers: [EchoController] })
    class AppModule {}

    // Logger explicitly enabled here. The point is to ensure the
    // request-id optimization in `setupRequestLogging` did not regress
    // the propagation behavior on the default code path.
    const app = await BnestFactory.create(AppModule, { logger: true });
    const inbound = "perf-fix-correlation-id";
    const res = await app.handle(
      new Request("http://localhost/echo-logged", {
        headers: { "x-request-id": inbound },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(inbound);

    const generatedRes = await app.handle(new Request("http://localhost/echo-logged"));
    expect(generatedRes.status).toBe(200);
    const generated = generatedRes.headers.get("x-request-id");
    expect(typeof generated).toBe("string");
    expect(generated && generated.length > 0).toBe(true);
  });

  test("validation pipe valid path stays allocation-cheap (smoke)", () => {
    @Dto()
    class SimpleDto {
      @IsString()
      name!: string;
    }

    const pipe = new ValidationPipe();
    const result = pipe.transform({ name: "ok" }, { type: "body", metatype: SimpleDto });
    expect(result).toEqual({ name: "ok" });
  });

  test("validation pipe respects stopAtFirstError option (no lazy wrapping)", () => {
    @Dto()
    class StrictDto {
      @IsString({ minLength: 2 })
      name!: string;

      @IsNumber()
      age!: number;
    }

    const pipe = new ValidationPipe({ stopAtFirstError: true });
    let caught: unknown;
    try {
      pipe.transform({ name: "A" }, { type: "body", metatype: StrictDto });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    // stopAtFirstError keeps the classic BadRequestException path; not lazy.
    expect(caught).not.toBeInstanceOf(LazyValidationException);
  });

  test("typed POST returns serialized JSON body when stringifier path is hit", async () => {
    const ResponseSchema = Schema.Object({
      echoed: Schema.String(),
    });

    @Controller("typed-post")
    class TypedPostController {
      @Post("/", { response: ResponseSchema })
      handle(@Body() body: { value: string }) {
        return { echoed: body.value };
      }
    }

    @Module({ controllers: [TypedPostController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const res = await app.handle(
      new Request("http://localhost/typed-post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "hello" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ echoed: "hello" });
  });
});
