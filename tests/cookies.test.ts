import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { setCookie } from "../src/security/cookies";
import { Cookie } from "../src/decorators/cookie.decorator";
import { __setIsProduction } from "../src/core/router/router-response-controller";

// ---------------------------------------------------------------------------
// setCookie helper unit tests
// ---------------------------------------------------------------------------

describe("setCookie() defaults", () => {
  test("sets httpOnly, sameSite=lax, path=/ by default", () => {
    const jar: Record<string, any> = {};
    // Simulate Elysia's cookie jar entry with a .set() method
    jar["session"] = {
      _value: "",
      _opts: {} as Record<string, unknown>,
      set(opts: Record<string, unknown>) {
        this._opts = opts;
        this._value = opts.value as string;
      },
    };
    setCookie(jar, "session", "abc123");
    const opts = jar["session"]._opts;
    expect(opts.value).toBe("abc123");
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    // secure defaults to false outside production
    expect(opts.secure).toBe(false);
  });

  test("secure=true in production", () => {
    // setCookie reads the framework-wide cached production flag; flip it via
    // __setIsProduction rather than mutating NODE_ENV at runtime.
    const prevProduction = (Bun.env.NODE_ENV ?? "") === "production";
    __setIsProduction(true);
    try {
      const jar: Record<string, any> = {};
      jar["tok"] = {
        set(opts: Record<string, unknown>) {
          (this as any)._opts = opts;
        },
      };
      setCookie(jar, "tok", "xyz");
      expect((jar["tok"] as any)._opts.secure).toBe(true);
    } finally {
      __setIsProduction(prevProduction);
    }
  });

  test("caller can override httpOnly to false", () => {
    const jar: Record<string, any> = {};
    jar["csrf"] = {
      set(opts: Record<string, unknown>) {
        (this as any)._opts = opts;
      },
    };
    setCookie(jar, "csrf", "token", { httpOnly: false });
    expect((jar["csrf"] as any)._opts.httpOnly).toBe(false);
  });

  test("maxAge and expires are forwarded when provided", () => {
    const jar: Record<string, any> = {};
    const exp = new Date(Date.now() + 3600_000);
    jar["x"] = {
      set(opts: Record<string, unknown>) {
        (this as any)._opts = opts;
      },
    };
    setCookie(jar, "x", "v", { maxAge: 3600, expires: exp });
    const opts = (jar["x"] as any)._opts;
    expect(opts.maxAge).toBe(3600);
    expect(opts.expires).toBe(exp);
  });
});

// ---------------------------------------------------------------------------
// @Cookie param decorator — integration tests
// ---------------------------------------------------------------------------

describe("@Cookie param decorator", () => {
  test("extracts the named cookie value from the request", async () => {
    @Controller("ck")
    class CookieController {
      @Get("/")
      read(@Cookie("session") session: string | undefined) {
        return { session: session ?? null };
      }
    }

    const app = await TechneFactory.create({
      controllers: [CookieController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/ck", {
        headers: { cookie: "session=my-session-token; other=foo" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBe("my-session-token");
  });

  test("returns undefined when the cookie is absent", async () => {
    @Controller("ck2")
    class CookieController2 {
      @Get("/")
      read(@Cookie("session") session: string | undefined) {
        return { session: session ?? null };
      }
    }

    const app = await TechneFactory.create({
      controllers: [CookieController2],
      logger: false,
    });

    const res = await app.handle(new Request("http://localhost/ck2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBeNull();
  });

  test("handles URL-encoded cookie values", async () => {
    @Controller("ck3")
    class CookieController3 {
      @Get("/")
      read(@Cookie("data") data: string | undefined) {
        return { data: data ?? null };
      }
    }

    const app = await TechneFactory.create({
      controllers: [CookieController3],
      logger: false,
    });

    const encoded = encodeURIComponent("hello world");
    const res = await app.handle(
      new Request("http://localhost/ck3", {
        headers: { cookie: `data=${encoded}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBe("hello world");
  });
});
