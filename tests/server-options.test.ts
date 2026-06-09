import { afterAll, describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Body } from "../src/decorators/params.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { resolveClientIp } from "../src/security";

function fakeCtx(socketAddress: string | undefined, headers: Record<string, string> = {}) {
  return {
    request: new Request("http://localhost/", { headers }),
    server: socketAddress ? { requestIP: () => ({ address: socketAddress }) } : undefined,
  };
}

describe("resolveClientIp()", () => {
  test("returns the socket peer address by default", () => {
    expect(resolveClientIp(fakeCtx("10.0.0.9"))).toBe("10.0.0.9");
  });

  test("ignores X-Forwarded-For when trustProxy is off", () => {
    const ctx = fakeCtx("10.0.0.9", { "x-forwarded-for": "1.2.3.4" });
    expect(resolveClientIp(ctx)).toBe("10.0.0.9");
    expect(resolveClientIp(ctx, false)).toBe("10.0.0.9");
  });

  test("trustProxy: true takes the rightmost X-Forwarded-For entry", () => {
    const ctx = fakeCtx("10.0.0.9", { "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(resolveClientIp(ctx, true)).toBe("5.6.7.8");
  });

  test("hops selects the Nth entry from the right", () => {
    const ctx = fakeCtx("10.0.0.9", { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" });
    expect(resolveClientIp(ctx, { hops: 2 })).toBe("5.6.7.8");
    expect(resolveClientIp(ctx, { hops: 3 })).toBe("1.2.3.4");
    // More hops than entries clamps to the leftmost value.
    expect(resolveClientIp(ctx, { hops: 10 })).toBe("1.2.3.4");
  });

  test("x-real-ip header mode", () => {
    const ctx = fakeCtx("10.0.0.9", { "x-real-ip": " 4.4.4.4 " });
    expect(resolveClientIp(ctx, { header: "x-real-ip" })).toBe("4.4.4.4");
  });

  test("falls back to socket address when the header is absent", () => {
    expect(resolveClientIp(fakeCtx("10.0.0.9"), true)).toBe("10.0.0.9");
  });

  test("returns undefined when nothing is resolvable (app.handle path)", () => {
    expect(resolveClientIp(fakeCtx(undefined))).toBeUndefined();
    expect(resolveClientIp(fakeCtx(undefined), true)).toBeUndefined();
  });
});

describe("server option — native Bun.serve limits", () => {
  @Controller("echo")
  class EchoController {
    @Get("/")
    ping() {
      return { ok: true };
    }

    @Post("/")
    echo(@Body() body: unknown) {
      return { received: body };
    }
  }

  const port = 41000 + Math.floor(Math.random() * 4000);
  let appRef: { close(): Promise<void> } | undefined;

  afterAll(async () => {
    await appRef?.close();
  });

  test("maxRequestBodySize rejects oversized bodies with a native 413", async () => {
    const app = await TechneFactory.create({
      controllers: [EchoController],
      logger: false,
      server: { maxRequestBodySize: 1024, idleTimeout: 30 },
    });
    appRef = app as any;
    await app.listen(port);

    const small = await fetch(`http://localhost:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(64) }),
    });
    expect(small.status).toBe(200);

    const oversized = await fetch(`http://localhost:${port}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(4096) }),
    });
    expect(oversized.status).toBe(413);
  });

  test("app.handle() still works when server options are set (bypasses Bun.serve)", async () => {
    const app = await TechneFactory.create({
      controllers: [EchoController],
      logger: false,
      server: { maxRequestBodySize: 16 },
    });
    // app.handle never touches a real socket, so the native limit does not
    // apply here — documented behavior.
    const res = await app.handle(
      new Request("http://localhost/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: "x".repeat(256) }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
