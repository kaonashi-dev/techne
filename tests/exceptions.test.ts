import { describe, expect, test } from "bun:test";
import { BnestFactory } from "../src/factory/techne-factory";
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

    const app = await BnestFactory.create(AppModule, { logger: false });

    const notFound = await app.handle(new Request("http://localhost/errors/not-found"));
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("content-type")).toContain("application/problem+json");
    expect(await notFound.json()).toMatchObject({
      type: "https://bnest.dev/errors/not-found",
      title: "Not Found",
      status: 404,
      detail: "User #99 not found",
      instance: "/errors/not-found",
    });

    const badRequest = await app.handle(new Request("http://localhost/errors/bad-request"));
    expect(badRequest.status).toBe(400);

    const generic = await app.handle(new Request("http://localhost/errors/generic"));
    expect(generic.status).toBe(500);
    const genericBody = await generic.json();
    expect(genericBody).toMatchObject({
      type: "https://bnest.dev/errors/internal-server-error",
      title: "Internal Server Error",
      status: 500,
    });
  });
});
