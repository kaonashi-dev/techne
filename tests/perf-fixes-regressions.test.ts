/**
 * Regression tests for the Batch 3 perf fixes.
 *
 *   1. `maybeStringify` reuses cached `ResponseInit` for status=200 and
 *      sets the correct content-type. We can't observe the constant identity
 *      from outside, but we can observe that the typed route emits a JSON
 *      body with the right `content-type` and a serialized payload.
 *
 *   2. Elysia-native validation failures are formatted as RFC 7807-style
 *      422 responses by the adapter's validation error hook.
 *
 *   3. The `x-request-id` response header is still echoed when the framework
 *      logger is enabled (default) — this guards the request-id optimization
 *      from accidentally regressing.
 */
import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body } from "../src/decorators/params.decorator";
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
    const app = await TechneFactory.create({
      controllers: [TypedController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/typed/user"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ id: 1, name: "Alice" });
  });
  test("invalid DTO body returns RFC 7807-style 422 from Elysia validation", async () => {
    @Dto()
    class CreateUserDto {
      @IsString({ minLength: 2 })
      name!: string;
      @IsNumber({ minimum: 0 })
      age!: number;
    }
    @Controller("native-validation")
    class ValidationController {
      @Post("/")
      create(
        @Body(CreateUserDto)
        body: CreateUserDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [ValidationController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/native-validation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.type).toBe("https://httpstatuses.com/422");
    expect(body.title).toBe("Unprocessable Entity");
    expect(Array.isArray(body.errors)).toBe(true);
  });
  test("request-id is echoed when the logger is enabled (default)", async () => {
    @Controller("echo-logged")
    class EchoController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }
    // Logger explicitly enabled here. The point is to ensure the
    // request-id optimization in `setupRequestLogging` did not regress
    // the propagation behavior on the default code path.
    const app = await TechneFactory.create({
      controllers: [EchoController],
      logger: true,
    });
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
  test("typed POST returns serialized JSON body when stringifier path is hit", async () => {
    const ResponseSchema = Schema.Object({
      echoed: Schema.String(),
    });
    @Controller("typed-post")
    class TypedPostController {
      @Post("/", { response: ResponseSchema })
      handle(
        @Body()
        body: { value: string },
      ) {
        return { echoed: body.value };
      }
    }
    const app = await TechneFactory.create({
      controllers: [TypedPostController],
      logger: false,
    });
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
