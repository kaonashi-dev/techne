import { describe, expect, test } from "bun:test";
import { BnestFactory } from "../src/factory/bnest-factory";
import { Body } from "../src/decorators/params.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Module } from "../src/decorators/module.decorator";
import { Post } from "../src/decorators/routes.decorator";
import { Schema, String, Integer, Boolean, Enum } from "../src/schema";

describe("enumType schema helper", () => {
  test("accepts TypeScript string enums", async () => {
    enum Role {
      Admin = "admin",
      Editor = "editor",
      Viewer = "viewer",
    }

    const CreateRoleSchema = Schema.Object({
      role: Schema.enum(Role),
    });

    @Controller("roles")
    class RoleController {
      @Post("/", { body: CreateRoleSchema })
      create(
        @Body()
        body: { role: Role },
      ) {
        return body;
      }
    }

    @Module({
      controllers: [RoleController],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule);

    const valid = await app.handle(
      new Request("http://localhost/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "editor" }),
      }),
    );

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ role: "editor" });

    const invalid = await app.handle(
      new Request("http://localhost/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "owner" }),
      }),
    );

    expect(invalid.status).toBe(422);
  });

  test("accepts readonly enum arrays", async () => {
    const roleValues = ["admin", "editor", "viewer"] as const;

    const CreateRoleSchema = Schema.Object({
      role: Schema.enum(roleValues),
    });

    @Controller("array-roles")
    class ArrayRoleController {
      @Post("/", { body: CreateRoleSchema })
      create(
        @Body()
        body: { role: (typeof roleValues)[number] },
      ) {
        return body;
      }
    }

    @Module({
      controllers: [ArrayRoleController],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule);

    const response = await app.handle(
      new Request("http://localhost/array-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "viewer" });
  });

  test("accepts class constructors as schema definition", async () => {
    enum UserRole {
      Admin = "admin",
      Editor = "editor",
    }

    class CreateUserDto {
      @String({ minLength: 2 })
      name!: string;

      @Enum(UserRole)
      role!: UserRole;

      @Integer()
      age!: number;

      @Boolean()
      active!: boolean;
    }

    @Controller("class-users")
    class ClassUserController {
      @Post("/", { body: Schema.Object(CreateUserDto) })
      create(@Body() body: any) {
        return body;
      }
    }

    @Module({
      controllers: [ClassUserController],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule);

    const valid = await app.handle(
      new Request("http://localhost/class-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", role: "admin", age: 30, active: true }),
      }),
    );

    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ name: "Alice", role: "admin", age: 30, active: true });

    const invalid = await app.handle(
      new Request("http://localhost/class-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A", role: "owner", age: 30, active: true }),
      }),
    );

    expect(invalid.status).toBe(422);
  });

  test("Schema helpers work alongside enum", async () => {
    const CreateComplexSchema = Schema.Object({
      name: Schema.String({ minLength: 2 }),
      active: Schema.Boolean(),
      count: Schema.Integer(),
      role: Schema.enum(["admin", "editor", "viewer"] as const),
      metadata: Schema.Optional(Schema.Record(Schema.String(), Schema.Any())),
    });

    @Controller("complex")
    class ComplexController {
      @Post("/", { body: CreateComplexSchema })
      create(@Body() body: any) {
        return body;
      }
    }

    @Module({
      controllers: [ComplexController],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule);

    const response = await app.handle(
      new Request("http://localhost/complex", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice", active: true, count: 42, role: "admin" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "Alice",
      active: true,
      count: 42,
      role: "admin",
    });
  });
});
