import { describe, expect, test } from "bun:test";
import { NestiaFactory } from "../src/factory/nestia-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { BadRequestException, HttpException, NotFoundException } from "../src/exceptions";

describe("HTTP exceptions", () => {
  test("serializes HttpException", () => {
    const exception = new HttpException(418, "short and stout", "Teapot");
    expect(exception.toJSON()).toEqual({
      statusCode: 418,
      message: "short and stout",
      error: "Teapot",
    });
  });

  test("maps framework exceptions to HTTP responses", async () => {
    @Controller("errors")
    class ErrorController {
      @Get("/not-found")
      notFound() {
        throw new NotFoundException("User #99 not found");
      }

      @Get("/bad-request")
      badRequest() {
        throw new BadRequestException("Bad input");
      }

      @Get("/generic")
      generic() {
        throw new Error("boom");
      }
    }

    @Module({ controllers: [ErrorController] })
    class AppModule {}

    const app = NestiaFactory.create(AppModule, { logger: false });

    const notFound = await app.handle(new Request("http://localhost/errors/not-found"));
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({
      statusCode: 404,
      message: "User #99 not found",
      error: "Not Found",
    });

    const badRequest = await app.handle(new Request("http://localhost/errors/bad-request"));
    expect(badRequest.status).toBe(400);

    const generic = await app.handle(new Request("http://localhost/errors/generic"));
    expect(generic.status).toBe(500);
    expect(await generic.json()).toEqual({
      statusCode: 500,
      message: "Internal Server Error",
      error: "Internal Server Error",
    });
  });
});
