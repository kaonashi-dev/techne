import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { NotFoundException } from "../src/exceptions";
describe("RFC 7807 error contract", () => {
  test("HttpException with options.code → status, type, title, detail, code, content-type", async () => {
    @Controller("users")
    class UsersController {
      @Get("/:id")
      find() {
        throw new NotFoundException("User #99 not found", { code: "user.not_found" });
      }
    }
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/users/99"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(body).toMatchObject({
      type: "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found.md",
      title: "Not Found",
      status: 404,
      detail: "User #99 not found",
      code: "user.not_found",
      instance: "/users/99",
    });
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
  });
  describe("plain Error → 500", () => {
    const originalEnv = Bun.env.NODE_ENV;
    beforeEach(() => {
      // ensure no leak from previous tests
      Bun.env.NODE_ENV = originalEnv;
    });
    afterEach(() => {
      Bun.env.NODE_ENV = originalEnv;
    });
    test("omits detail in production", async () => {
      Bun.env.NODE_ENV = "production";
      @Controller("boom")
      class BoomController {
        @Get("/")
        explode() {
          throw new Error("internal db secret leak");
        }
      }
      const app = await TechneFactory.create({
        controllers: [BoomController],
        logger: false,
      });
      const res = await app.handle(new Request("http://localhost/boom"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({
        type: "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/internal-server-error.md",
        title: "Internal Server Error",
        status: 500,
      });
      expect(body.detail).toBeUndefined();
    });
    test("includes detail outside production", async () => {
      Bun.env.NODE_ENV = "development";
      @Controller("boom-dev")
      class BoomDevController {
        @Get("/")
        explode() {
          throw new Error("nice debug message");
        }
      }
      const app = await TechneFactory.create({
        controllers: [BoomDevController],
        logger: false,
      });
      const res = await app.handle(new Request("http://localhost/boom-dev"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.detail).toBe("nice debug message");
    });
  });
  test("echoes x-request-id from request header", async () => {
    @Controller("echo")
    class EchoController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [EchoController],
      logger: false,
    });
    const inbound = "test-request-id-1234";
    const res = await app.handle(
      new Request("http://localhost/echo", {
        headers: { "x-request-id": inbound },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe(inbound);
  });
  test("generates an x-request-id when the inbound header is absent", async () => {
    @Controller("gen")
    class GenController {
      @Get("/")
      ok() {
        return { ok: true };
      }
    }
    const app = await TechneFactory.create({
      controllers: [GenController],
      logger: false,
    });
    const res = await app.handle(new Request("http://localhost/gen"));
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(typeof id).toBe("string");
    expect(id && id.length > 0).toBe(true);
  });
  test("non-Error throws (string) map to 500, detail only outside production", async () => {
    const originalEnv = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = "production";
    try {
      @Controller("throw-string")
      class ThrowStringController {
        @Get("/")
        nope() {
          // eslint-disable-next-line no-throw-literal
          throw "raw string error";
        }
      }
      const app = await TechneFactory.create({
        controllers: [ThrowStringController],
        logger: false,
      });
      const res = await app.handle(new Request("http://localhost/throw-string"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.status).toBe(500);
      expect(body.detail).toBeUndefined();
    } finally {
      Bun.env.NODE_ENV = originalEnv;
    }
  });
});
