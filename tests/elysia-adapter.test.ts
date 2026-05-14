import { test, expect, describe } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Container } from "../src/core/container";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body, Param, Query } from "../src/decorators/params.decorator";
import { UseGuards } from "../src/decorators/use-guards.decorator";
describe("Elysia Adapter via TechneFactory", () => {
  test("should handle GET requests", async () => {
    @Controller("test")
    class TestController {
      @Get("/hello")
      sayHello() {
        return { msg: "world" };
      }
    }
    const app = await TechneFactory.create({ controllers: [TestController] });
    const response = await app
      .handle(new Request("http://localhost/test/hello"))
      .then((r) => r.json());
    expect(response).toEqual({ msg: "world" });
  });
  test("should bind params correctly", async () => {
    @Controller("users")
    class UserController {
      @Get("/:id")
      getUser(
        @Param("id")
        id: string,
      ) {
        return { id };
      }
    }
    const app = await TechneFactory.create({ controllers: [UserController] });
    const response = await app
      .handle(new Request("http://localhost/users/123"))
      .then((r) => r.json());
    expect(response).toEqual({ id: "123" });
  });
  test("should bind body correctly", async () => {
    @Controller("users")
    class UserController {
      @Post("/create")
      createUser(
        @Body()
        body: any,
      ) {
        return { created: body.name };
      }
    }
    const app = await TechneFactory.create({ controllers: [UserController] });
    const req = new Request("http://localhost/users/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    const response = await app.handle(req).then((r) => r.json());
    expect(response).toEqual({ created: "Alice" });
  });
  test("should bind query parameters correctly", async () => {
    @Controller("search")
    class SearchController {
      @Get("/")
      search(
        @Query("q")
        query: string,
      ) {
        return { query };
      }
    }
    const app = await TechneFactory.create({ controllers: [SearchController] });
    const response = await app
      .handle(new Request("http://localhost/search?q=bun"))
      .then((r) => r.json());
    expect(response).toEqual({ query: "bun" });
  });
  test("should enforce guards correctly", async () => {
    class AuthGuard {
      canActivate(context: any) {
        return context.ctx.query?.token === "secret";
      }
    }
    @Controller("protected")
    @UseGuards(AuthGuard)
    class ProtectedController {
      @Get("/data")
      getData() {
        return { data: "sensitive" };
      }
    }
    const app = await TechneFactory.create({
      controllers: [ProtectedController],
      providers: [AuthGuard],
    });
    const req1 = new Request("http://localhost/protected/data");
    const res1 = await app.handle(req1);
    expect(res1.status).toBe(403);
    const body1 = await res1.json();
    expect(body1).toMatchObject({
      type: "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/forbidden.md",
      title: "Forbidden",
      status: 403,
      detail: "Forbidden resource",
    });
    const req2 = new Request("http://localhost/protected/data?token=secret");
    const res2 = await app.handle(req2);
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual({ data: "sensitive" });
  });
  test("should validate body with Schema helpers", async () => {
    @Controller("validated")
    class ValidatedController {
      @Post("/")
      create(
        @Body()
        body: any,
      ) {
        return body;
      }
    }
    const app = await TechneFactory.create({ controllers: [ValidatedController] });
    const req = new Request("http://localhost/validated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    const response = await app.handle(req).then((r) => r.json());
    expect(response).toEqual({ name: "Alice" });
  });
  test("should use the application container for guards", async () => {
    class AuthGuard {
      canActivate(context: any) {
        return context.ctx.query?.token === "secret";
      }
    }
    @Controller("protected")
    @UseGuards(AuthGuard)
    class ProtectedController {
      @Get("/data")
      getData() {
        return { ok: true };
      }
    }
    const container = new Container();
    container.addProvider({ provide: AuthGuard, useValue: new AuthGuard() });
    const app = await TechneFactory.create({
      controllers: [ProtectedController],
      logger: false,
      container,
    });
    const response = await app.handle(new Request("http://localhost/protected/data?token=secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
