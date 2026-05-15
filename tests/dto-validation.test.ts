import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Body } from "../src/decorators/params.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Post } from "../src/decorators/routes.decorator";
import {
  Dto,
  IsString,
  IsNumber,
  IsBoolean,
  IsInteger,
  IsEnum,
  IsOptional,
  MaxLength,
  Min,
  Schema,
  ValidateNested,
} from "../src/schema";
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
class AddressDto {
  @IsString()
  city!: string;
  @IsString()
  country!: string;
}
class CreateProfileDto {
  @IsString()
  @MaxLength(20)
  name!: string;
  @IsOptional()
  @Min(18)
  age?: number;
  @ValidateNested()
  address!: AddressDto;
}
@Dto({ allowAdditional: true })
class LooseDto {
  @IsString()
  name!: string;
}
describe("@Dto() + @Body(DtoClass) — auto schema injection", () => {
  test("validates body and returns 200 for valid payload", async () => {
    @Controller("users")
    class UsersController {
      @Post("/")
      create(
        @Body(CreateUserDto)
        body: CreateUserDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
    });
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
      create(
        @Body(CreateUserDto)
        body: CreateUserDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [UsersInvalidController],
      logger: false,
    });
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
      handle(
        @Body(CreateUserDto)
        body: any,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [ExplicitController],
      logger: false,
    });
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
      create(
        @Body(CreateProductDto)
        body: CreateProductDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [ProductsController],
      logger: false,
    });
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
      handle(
        @Body()
        body: any,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [RawController],
      logger: false,
    });
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
  test("infers typed @Body() DTO without @Dto decorator", async () => {
    @Controller("profiles")
    class ProfilesController {
      @Post("/")
      create(
        @Body()
        body: CreateProfileDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [ProfilesController],
      logger: false,
    });
    const valid = await app.handle(
      new Request("http://localhost/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "alice",
          address: { city: "Paris", country: "FR" },
        }),
      }),
    );
    expect(valid.status).toBe(200);
    const invalid = await app.handle(
      new Request("http://localhost/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "alice",
          address: { city: 42, country: "FR" },
        }),
      }),
    );
    expect(invalid.status).toBe(422);
  });
  test("native DTO schemas reject unknown properties by default", async () => {
    @Controller("strict-profiles")
    class StrictProfilesController {
      @Post("/")
      create(
        @Body()
        body: CreateProfileDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [StrictProfilesController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/strict-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "alice",
          age: 22,
          extra: true,
          address: { city: "Paris", country: "FR" },
        }),
      }),
    );
    expect(res.status).toBe(422);
  });
  test("@Dto({ allowAdditional: true }) allows unknown properties", async () => {
    @Controller("loose")
    class LooseController {
      @Post("/")
      create(
        @Body(LooseDto)
        body: LooseDto,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({
      controllers: [LooseController],
      logger: false,
    });
    const res = await app.handle(
      new Request("http://localhost/loose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "alice", extra: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: "alice", extra: true });
  });
});
