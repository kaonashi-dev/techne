import { test, expect, describe } from "bun:test";
import { NestiaFactory } from "../src/factory/nestia-factory";
import { Module } from "../src/decorators/module.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body, Param, Query } from "../src/decorators/params.decorator";
import { UseGuards } from "../src/decorators/use-guards.decorator";

describe("Elysia Adapter via NestiaFactory", () => {
  test("should handle GET requests", async () => {
    @Controller("test")
    class TestController {
      @Get("/hello")
      sayHello() {
        return { msg: "world" };
      }
    }

    @Module({ controllers: [TestController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

    const response = await app
      .handle(new Request("http://localhost/test/hello"))
      .then((r) => r.json());
    expect(response).toEqual({ msg: "world" });
  });

  test("should bind params correctly", async () => {
    @Controller("users")
    class UserController {
      @Get("/:id")
      getUser(@Param("id") id: string) {
        return { id };
      }
    }

    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

    const response = await app
      .handle(new Request("http://localhost/users/123"))
      .then((r) => r.json());
    expect(response).toEqual({ id: "123" });
  });

  test("should bind body correctly", async () => {
    @Controller("users")
    class UserController {
      @Post("/create")
      createUser(@Body() body: any) {
        return { created: body.name };
      }
    }

    @Module({ controllers: [UserController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

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
      search(@Query("q") query: string) {
        return { query };
      }
    }

    @Module({ controllers: [SearchController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

    const response = await app
      .handle(new Request("http://localhost/search?q=bun"))
      .then((r) => r.json());
    expect(response).toEqual({ query: "bun" });
  });

  test("should enforce guards correctly", async () => {
    class AuthGuard {
      canActivate(context: any) {
        return context.query?.token === "secret";
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

    @Module({ controllers: [ProtectedController], providers: [AuthGuard] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

    const req1 = new Request("http://localhost/protected/data");
    const res1 = await app.handle(req1);
    expect(res1.status).toBe(403);
    const body1 = await res1.json();
    expect(body1).toEqual({
      statusCode: 403,
      message: "Forbidden resource",
      error: "Forbidden",
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
      create(@Body() body: any) {
        return body;
      }
    }

    @Module({ controllers: [ValidatedController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule);

    const req = new Request("http://localhost/validated", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });

    const response = await app.handle(req).then((r) => r.json());
    expect(response).toEqual({ name: "Alice" });
  });
});
