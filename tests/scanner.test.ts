import { test, expect, describe } from "bun:test";
import { Scanner } from "../src/core/scanner";
import { RouterExplorer } from "../src/core/router/router-explorer";
import { Module } from "../src/decorators/module.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";

describe("Scanner", () => {
  test("should scan modules and extract controllers routes", async () => {
    const scanner = new Scanner();

    @Controller("users")
    class UserController {
      @Get("/")
      getUsers() {}

      @Post("/create")
      createUser() {}
    }

    @Controller("posts")
    class PostController {
      @Get("/:id")
      getPost() {}
    }

    @Module({
      controllers: [PostController],
    })
    class PostModule {}

    @Module({
      imports: [PostModule],
      controllers: [UserController],
    })
    class AppModule {}

    await scanner.scan(AppModule);
    const routes = new RouterExplorer(scanner).explore();

    expect(routes).toHaveLength(3);

    // Check User routes
    const getRoutes = routes.filter((r) => r.method === "GET" && r.fullPath === "/users");
    expect(getRoutes).toHaveLength(1);
    expect(getRoutes[0].handlerName).toBe("getUsers");

    const postRoutes = routes.filter((r) => r.method === "POST" && r.fullPath === "/users/create");
    expect(postRoutes).toHaveLength(1);

    // Check Post routes (from imported module)
    const postGetRoutes = routes.filter((r) => r.method === "GET" && r.fullPath === "/posts/:id");
    expect(postGetRoutes).toHaveLength(1);
  });
});
