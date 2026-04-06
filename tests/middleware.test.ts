import { test, expect } from "bun:test";
import { Scanner } from "../src/core/scanner";
import { RoutesResolver } from "../src/core/router/routes-resolver";
import { ElysiaAdapter } from "../src/platform/elysia-adapter";
import { Controller, Get, Module, Middleware } from "../src/decorators";

test("middleware - should apply controller and route middlewares", async () => {
  const log: string[] = [];

  const middleware1 = () => {
    log.push("controller middleware");
  };
  const middleware2 = () => {
    log.push("route middleware");
  };

  @Controller("test")
  @Middleware(middleware1)
  class TestController {
    @Get("hello")
    @Middleware(middleware2)
    hello() {
      log.push("handler");
      return "world";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const scanner = new Scanner();
  await scanner.scan(TestModule);

  const adapter = new ElysiaAdapter();
  new RoutesResolver(scanner).resolve(adapter);

  const app = adapter.getInstance();

  const response = await app.handle(new Request("http://localhost/test/hello"));

  expect(await response.text()).toBe("world");
  expect(log).toEqual(["controller middleware", "route middleware", "handler"]);
});
