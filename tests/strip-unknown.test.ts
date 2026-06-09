import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Post } from "../src/decorators/routes.decorator";
import { Body } from "../src/decorators/params.decorator";
import { Dto, IsString, IsNumber, IsOptional } from "../src/schema";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

@Dto({ stripUnknown: true })
class StripDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  age?: number;
}

@Dto()
class StrictDto {
  @IsString()
  name!: string;
}

describe("strip-unknown via @Dto({ stripUnknown: true })", () => {
  test("known properties pass through normally", async () => {
    @Controller("strip-ok")
    class StripOkController {
      @Post("/")
      create(@Body(StripDto) body: StripDto) {
        return body;
      }
    }

    const app = await TechneFactory.create({
      controllers: [StripOkController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/strip-ok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", age: 30 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Alice");
    expect(body.age).toBe(30);
  });

  test("unknown properties are stripped instead of rejected", async () => {
    @Controller("strip-extra")
    class StripExtraController {
      @Post("/")
      create(@Body(StripDto) body: StripDto) {
        return body;
      }
    }

    const app = await TechneFactory.create({
      controllers: [StripExtraController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/strip-extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bob", age: 25, extra: true, other: "x" }),
      }),
    );
    // Should succeed (not 422)
    expect(res.status).toBe(200);
    const body = await res.json();
    // Known fields are preserved
    expect(body.name).toBe("Bob");
    expect(body.age).toBe(25);
    // Unknown fields are removed
    expect(body.extra).toBeUndefined();
    expect(body.other).toBeUndefined();
  });

  test("invalid known property still yields 422", async () => {
    @Controller("strip-invalid")
    class StripInvalidController {
      @Post("/")
      create(@Body(StripDto) body: StripDto) {
        return body;
      }
    }

    const app = await TechneFactory.create({
      controllers: [StripInvalidController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/strip-invalid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // name is required but missing
        body: JSON.stringify({ age: 25, extra: "ignored" }),
      }),
    );
    expect(res.status).toBe(422);
  });

  test("strict DTO (no stripUnknown) still rejects extra properties", async () => {
    @Controller("strict-no-strip")
    class StrictNoStripController {
      @Post("/")
      create(@Body(StrictDto) body: StrictDto) {
        return body;
      }
    }

    const app = await TechneFactory.create({
      controllers: [StrictNoStripController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/strict-no-strip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", extra: true }),
      }),
    );
    // Strict DTO rejects unknown properties
    expect(res.status).toBe(422);
  });
});
