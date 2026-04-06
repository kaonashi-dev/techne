import { describe, expect, test } from "bun:test";
import { BnestFactory } from "../src/factory/bnest-factory";
import { Body } from "../src/decorators/params.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Module } from "../src/decorators/module.decorator";
import { Post } from "../src/decorators/routes.decorator";
import { Dto, IsString, IsNumber, IsBoolean, IsInteger, IsEnum, Schema } from "../src/schema";

enum Role {
  Admin = "admin",
  Editor = "editor",
}

@Dto()
class CreateUserDto {
  @IsString({ minLength: 2 })
  name!: string;

  @IsNumber({ minimum: 0, maximum: 120 })
  age!: number;

  @IsBoolean()
  active!: boolean;
}

@Dto()
class CreateProductDto {
  @IsString({ minLength: 1 })
  title!: string;

  @IsInteger({ minimum: 0 })
  stock!: number;

  @IsEnum(Role)
  role!: Role;
}

describe("@Dto() + @Body(DtoClass) — auto schema injection", () => {
  test("validates body and returns 200 for valid payload", async () => {
    @Controller("users")
    class UsersController {
      @Post("/")
      create(@Body(CreateUserDto) body: CreateUserDto) {
        return body;
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    const res = await app.handle(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", age: 30, active: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "Alice", age: 30, active: true });
  });

  test("returns 422 when body fails validation", async () => {
    @Controller("users-invalid")
    class UsersInvalidController {
      @Post("/")
      create(@Body(CreateUserDto) body: CreateUserDto) {
        return body;
      }
    }

    @Module({ controllers: [UsersInvalidController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    // name too short
    const res = await app.handle(
      new Request("http://localhost/users-invalid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A", age: 30, active: true }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test("explicit route schema takes priority over @Body(Dto)", async () => {
    // If the route already declares a body schema, it must NOT be overridden
    // by the DTO schema from @Body(CreateUserDto).
    // The explicit schema only requires `value: number`, so a payload that
    // violates CreateUserDto (no `name`, `age`, `active`) should still pass.
    const explicitBodySchema = Schema.Object({ value: Schema.Number() });

    @Controller("explicit")
    class ExplicitController {
      @Post("/", { body: explicitBodySchema })
      handle(@Body(CreateUserDto) body: any) {
        return body;
      }
    }

    @Module({ controllers: [ExplicitController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    // Valid against the explicit schema only (CreateUserDto fields are absent)
    const res = await app.handle(
      new Request("http://localhost/explicit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 42 }),
      }),
    );

    expect(res.status).toBe(200);
  });

  test("works with IsEnum and IsInteger", async () => {
    @Controller("products")
    class ProductsController {
      @Post("/")
      create(@Body(CreateProductDto) body: CreateProductDto) {
        return body;
      }
    }

    @Module({ controllers: [ProductsController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    const valid = await app.handle(
      new Request("http://localhost/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Widget", stock: 10, role: "admin" }),
      }),
    );

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ title: "Widget", stock: 10, role: "admin" });

    const invalid = await app.handle(
      new Request("http://localhost/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Widget", stock: -1, role: "unknown" }),
      }),
    );

    expect(invalid.status).toBe(422);
  });

  test("backwards compat — @Body() without DTO still works", async () => {
    @Controller("raw")
    class RawController {
      @Post("/")
      handle(@Body() body: any) {
        return body;
      }
    }

    @Module({ controllers: [RawController] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });

    const res = await app.handle(
      new Request("http://localhost/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anything: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ anything: true });
  });
});
