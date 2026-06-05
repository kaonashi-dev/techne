import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Delete, Get, Patch, Post, Put } from "../src/decorators/routes.decorator";
import { Body, Param } from "../src/decorators/params.decorator";
import { UseGuards } from "../src/decorators/use-guards.decorator";
import { getControllerDescriptor } from "../src/core/metadata-store";
import { Dto, IsString } from "../src/schema";
import { TechneFactory } from "../src/factory/techne-factory";

describe("Single-action controllers — class-level verb decorators", () => {
  test("a bare @Get on the class binds the route to handle()", async () => {
    @Get("/hello")
    class HelloAction {
      handle() {
        return { msg: "world" };
      }
    }
    const app = await TechneFactory.create({ controllers: [HelloAction], logger: false });

    const res = await app.handle(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ msg: "world" });
  });

  test("path params bind to handle() arguments", async () => {
    @Get("/users/:id")
    class ShowUser {
      handle(@Param("id") id: string) {
        return { id };
      }
    }
    const app = await TechneFactory.create({ controllers: [ShowUser], logger: false });

    const res = await app.handle(new Request("http://localhost/users/42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "42" });
  });

  test("@Body(Dto) on handle() auto-injects the schema and validates", async () => {
    @Dto()
    class CreateUserDto {
      @IsString({ minLength: 2 })
      name!: string;
    }
    @Post("/users")
    class CreateUser {
      handle(@Body(CreateUserDto) body: CreateUserDto) {
        return body;
      }
    }
    const app = await TechneFactory.create({ controllers: [CreateUser], logger: false });

    const ok = await app.handle(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Alice" });

    // name too short → schema rejects before the handler runs.
    const bad = await app.handle(
      new Request("http://localhost/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "A" }),
      }),
    );
    expect(bad.status).toBe(422);
  });

  test("@Controller prefix composes with the class-level route path", async () => {
    @Controller("admin")
    @Post("/reports")
    class CreateReport {
      handle(@Body() body: any) {
        return { created: body.title };
      }
    }
    const app = await TechneFactory.create({ controllers: [CreateReport], logger: false });

    const res = await app.handle(
      new Request("http://localhost/admin/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Q3" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: "Q3" });
  });

  test("class-level @UseGuards gates the single action", async () => {
    class TokenGuard {
      canActivate(context: any) {
        return context.ctx.query?.token === "secret";
      }
    }
    @Get("/secret")
    @UseGuards(TokenGuard)
    class SecretAction {
      handle() {
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({ controllers: [SecretAction], logger: false });

    const allowed = await app.handle(new Request("http://localhost/secret?token=secret"));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });

    const denied = await app.handle(new Request("http://localhost/secret"));
    expect(denied.status).not.toBe(200);
  });

  test("class-level and method-level routes coexist on one controller", async () => {
    @Controller("mix")
    @Get("/root")
    class MixController {
      handle() {
        return { from: "handle" };
      }
      @Get("/extra")
      extra() {
        return { from: "extra" };
      }
    }
    const app = await TechneFactory.create({ controllers: [MixController], logger: false });

    const root = await app.handle(new Request("http://localhost/mix/root"));
    expect(await root.json()).toEqual({ from: "handle" });

    const extra = await app.handle(new Request("http://localhost/mix/extra"));
    expect(await extra.json()).toEqual({ from: "extra" });
  });

  test("PUT / PATCH / DELETE work at the class level", async () => {
    @Put("/things/:id")
    class UpdateThing {
      handle(@Param("id") id: string) {
        return { updated: id };
      }
    }
    @Patch("/things/:id")
    class PatchThing {
      handle(@Param("id") id: string) {
        return { patched: id };
      }
    }
    @Delete("/things/:id")
    class DeleteThing {
      handle(@Param("id") id: string) {
        return { deleted: id };
      }
    }
    const app = await TechneFactory.create({
      controllers: [UpdateThing, PatchThing, DeleteThing],
      logger: false,
    });

    const put = await app.handle(new Request("http://localhost/things/1", { method: "PUT" }));
    expect(await put.json()).toEqual({ updated: "1" });

    const patch = await app.handle(new Request("http://localhost/things/2", { method: "PATCH" }));
    expect(await patch.json()).toEqual({ patched: "2" });

    const del = await app.handle(new Request("http://localhost/things/3", { method: "DELETE" }));
    expect(await del.json()).toEqual({ deleted: "3" });
  });

  test("class-level decorator records a route bound to handle in the descriptor", () => {
    @Get("/meta")
    class MetaAction {
      handle() {
        return null;
      }
    }
    const descriptor = getControllerDescriptor(MetaAction);
    expect(descriptor?.routes).toContainEqual(
      expect.objectContaining({ path: "/meta", method: "GET", handlerName: "handle" }),
    );
  });

  test("a class-level route without a handle method throws at decoration time", () => {
    expect(() => {
      @Get("/broken")
      class Broken {}
      return Broken;
    }).toThrow(/missing a "handle" method/);
  });
});
