import { test, expect, describe } from "bun:test";
import { Scanner } from "../src/core/scanner";
import { RouterExplorer } from "../src/core/router/router-explorer";
import { getControllerDescriptor } from "../src/core/metadata-store";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
describe("Scanner", () => {
  test("should scan flat config and extract controller routes", async () => {
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
    scanner.scanFlat({ controllers: [UserController, PostController] });
    const routes = new RouterExplorer(scanner).explore();
    expect(routes).toHaveLength(3);
    // Check User routes
    const getRoutes = routes.filter((r) => r.method === "GET" && r.fullPath === "/users");
    expect(getRoutes).toHaveLength(1);
    expect(getRoutes[0].handlerName).toBe("getUsers");
    const postRoutes = routes.filter((r) => r.method === "POST" && r.fullPath === "/users/create");
    expect(postRoutes).toHaveLength(1);
    // Check Post routes
    const postGetRoutes = routes.filter((r) => r.method === "GET" && r.fullPath === "/posts/:id");
    expect(postGetRoutes).toHaveLength(1);
  });
  test("stores controller descriptors under Symbol.metadata", () => {
    @Controller("meta")
    class MetadataController {
      @Get("/")
      ok() {}
    }

    const descriptor = getControllerDescriptor(MetadataController);
    expect(descriptor?.prefix).toBe("meta");
    expect(descriptor?.routes).toHaveLength(1);
    expect((MetadataController as any)[Symbol.metadata]?.techne?.controller).toBe(descriptor);
  });
});
