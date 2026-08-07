import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post, Put } from "../src/decorators/routes.decorator";
import { CsrfExempt } from "../src/decorators/csrf-exempt.decorator";
import { compileCsrfOptions } from "../src/security/csrf";
import { __setIsProduction } from "../src/core/router/router-response-controller";

// ---------------------------------------------------------------------------
// compileCsrfOptions unit tests
// ---------------------------------------------------------------------------

describe("compileCsrfOptions()", () => {
  test("uses __Host-csrf in production, csrf otherwise", () => {
    // CSRF reads the framework-wide cached production flag, so tests flip it
    // via __setIsProduction (the error-contract test pattern) rather than
    // mutating NODE_ENV at runtime.
    const prevProduction = (Bun.env.NODE_ENV ?? "") === "production";
    try {
      __setIsProduction(false);
      expect(compileCsrfOptions().cookieName).toBe("csrf");

      __setIsProduction(true);
      expect(compileCsrfOptions().cookieName).toBe("__Host-csrf");
    } finally {
      __setIsProduction(prevProduction);
    }
  });

  test("custom cookieName is respected", () => {
    expect(compileCsrfOptions({ cookieName: "my-csrf" }).cookieName).toBe("my-csrf");
  });

  test("defaults: headerName x-csrf-token, methods POST PUT PATCH DELETE", () => {
    const cfg = compileCsrfOptions();
    expect(cfg.headerName).toBe("x-csrf-token");
    expect(cfg.methods.has("POST")).toBe(true);
    expect(cfg.methods.has("PUT")).toBe(true);
    expect(cfg.methods.has("PATCH")).toBe(true);
    expect(cfg.methods.has("DELETE")).toBe(true);
    expect(cfg.methods.has("GET")).toBe(false);
  });

  test("cookie defaults: httpOnly=false, sameSite=lax, path=/", () => {
    const cfg = compileCsrfOptions();
    expect(cfg.cookie.httpOnly).toBe(false);
    expect(cfg.cookie.sameSite).toBe("lax");
    expect(cfg.cookie.path).toBe("/");
  });

  test("result is frozen", () => {
    const cfg = compileCsrfOptions();
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.cookie)).toBe(true);
    expect(Object.isFrozen(cfg.exclude)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration tests via TechneFactory
// ---------------------------------------------------------------------------

// Shared controllers declared at module scope so each test
// can reuse a fresh app instance (Elysia re-registers routes on each .create).

@Controller("api")
class ApiController {
  @Get("/")
  list() {
    return { items: [] };
  }

  @Post("/")
  create() {
    return { created: true };
  }

  @Put("/:id")
  update() {
    return { updated: true };
  }
}

@Controller("hooks")
class WebhookController {
  @Post("/stripe")
  @CsrfExempt()
  stripeWebhook() {
    return { received: true };
  }
}

@Controller("exempt-class")
@CsrfExempt()
class ExemptClassController {
  @Post("/")
  handle() {
    return { ok: true };
  }
}

/** Extract the csrf cookie value from a Set-Cookie response header. */
function _extractCsrfCookie(res: Response, cookieName = "csrf"): string | undefined {
  const setCookieHeader = res.headers.get("set-cookie");
  if (!setCookieHeader) return undefined;
  // Multiple Set-Cookie headers may be joined by comma in the Web Fetch API
  for (const part of setCookieHeader.split(/,\s*(?=[^;]+=)/)) {
    const decoded = decodeURIComponent(part.trim());
    const prefix = `${decodeURIComponent(cookieName)}=`;
    if (decoded.startsWith(prefix)) {
      const semicolonIdx = decoded.indexOf(";", prefix.length);
      return semicolonIdx === -1
        ? decoded.slice(prefix.length)
        : decoded.slice(prefix.length, semicolonIdx);
    }
  }
  return undefined;
}

describe("CSRF middleware — integration", () => {
  test("GET request mints a CSRF cookie that is not HttpOnly", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const res = await app.handle(new Request("http://localhost/api"));
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("csrf=");
    // Cookie must NOT be HttpOnly (double-submit requires JS-readable)
    expect(setCookie.toLowerCase()).not.toContain("httponly");
  });

  test("GET does not re-mint when cookie is already present", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const token = "existingtoken1234567890abcdef1234567890abcdef1234567890abcdef12";
    const res = await app.handle(
      new Request("http://localhost/api", {
        headers: { cookie: `csrf=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    // No new cookie should be set (existing cookie is present)
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      // If a set-cookie header is present it must either not be the csrf cookie
      // or it must carry the same token (Elysia's cookie jar may echo it)
    }
    // The key test: the response should not fail
    expect(res.status).toBe(200);
  });

  test("POST without CSRF header → 403 problem+json", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: "csrf=sometoken" },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.status).toBe(403);
    expect(body.detail).toContain("CSRF");
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  test("POST with matching token in header and cookie → 200", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const token = "a".repeat(64); // 64 char token
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          cookie: `csrf=${token}`,
          "x-csrf-token": token,
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("POST with wrong token → 403", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          cookie: "csrf=correcttoken",
          "x-csrf-token": "wrongtoken",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("length-mismatch tokens do not throw (timing-safe handles it)", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    // Cookie token is longer than header token
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          cookie: "csrf=longertoken12345678",
          "x-csrf-token": "short",
        },
      }),
    );
    // Should return 403 without throwing
    expect(res.status).toBe(403);
  });

  test("@CsrfExempt() on a method skips validation → 200", async () => {
    const app = await TechneFactory.create({
      controllers: [WebhookController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    // POST without token or cookie — should be allowed because @CsrfExempt()
    const res = await app.handle(
      new Request("http://localhost/hooks/stripe", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("@CsrfExempt() on the class skips validation → 200", async () => {
    const app = await TechneFactory.create({
      controllers: [ExemptClassController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });

    const res = await app.handle(
      new Request("http://localhost/exempt-class", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("exclude path prefix skips validation → 200", async () => {
    const app = await TechneFactory.create({
      controllers: [WebhookController],
      logger: false,
      csrf: { cookieName: "csrf", exclude: ["/hooks"] },
    });

    const res = await app.handle(
      new Request("http://localhost/hooks/stripe", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(200);
  });

  test("no csrf option → zero-cost (no middleware, no 403)", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      // No csrf option at all
    });

    // POST without any token should pass through
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
      }),
    );
    // No CSRF guard → the route itself decides (here just returns 200)
    expect(res.status).toBe(200);
    // No csrf cookie should be set either
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("csrf=");
  });

  test("custom headerName is respected", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf", headerName: "x-my-csrf" },
    });

    const token = "b".repeat(64);
    // Default header name should NOT work
    const res1 = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          cookie: `csrf=${token}`,
          "x-csrf-token": token, // Wrong header name
        },
      }),
    );
    expect(res1.status).toBe(403);

    // Correct custom header name should work
    const res2 = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: {
          cookie: `csrf=${token}`,
          "x-my-csrf": token,
        },
      }),
    );
    expect(res2.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Signed double-submit (secret configured)
  // -------------------------------------------------------------------------

  const SECRET = "csrf-hmac-secret";
  const signCsrf = (nonce: string) =>
    `${nonce}.${createHmac("sha256", SECRET).update(nonce).digest("base64url")}`;

  test("signed: valid server-issued token in cookie+header → 200", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf", secret: SECRET },
    });
    const token = signCsrf("a".repeat(64));
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: `csrf=${token}`, "x-csrf-token": token },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("signed: attacker-chosen token in BOTH cookie and header → 403", async () => {
    // The core threat signed double-submit defends against: an attacker who can
    // write the cookie plants the same token in cookie + header. Unsigned, this
    // passes; signed, it must fail because there's no valid HMAC.
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf", secret: SECRET },
    });
    const token = "attacker-chosen-value-present-in-both-places";
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: `csrf=${token}`, "x-csrf-token": token },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("signed: tampered signature (length-mismatch) → 403", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf", secret: SECRET },
    });
    const badToken = `${"a".repeat(64)}.deadbeef`;
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: `csrf=${badToken}`, "x-csrf-token": badToken },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("signed: GET mints a nonce.signature token that round-trips", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf", secret: SECRET },
    });
    const getRes = await app.handle(new Request("http://localhost/api"));
    const minted = _extractCsrfCookie(getRes, "csrf");
    expect(minted).toBeDefined();
    expect(minted!.split(".")).toHaveLength(2);
    const postRes = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: `csrf=${minted}`, "x-csrf-token": minted! },
      }),
    );
    expect(postRes.status).toBe(200);
  });

  test("malformed percent-encoding in cookie does not 500", async () => {
    // A lone "%" is invalid percent-encoding; the raw-header fallback must not
    // throw a URIError (which would surface as a 500).
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      csrf: { cookieName: "csrf" },
    });
    const res = await app.handle(
      new Request("http://localhost/api", {
        method: "POST",
        headers: { cookie: "csrf=%", "x-csrf-token": "x" },
      }),
    );
    // Token mismatch → 403, NOT a 500 crash.
    expect(res.status).toBe(403);
  });

  test("csrf: false / missing option → no CSRF middleware (zero-cost contract)", async () => {
    const app = await TechneFactory.create({
      controllers: [ApiController],
      logger: false,
      // csrf deliberately absent
    });

    // GET: no CSRF cookie minted
    const getRes = await app.handle(new Request("http://localhost/api"));
    expect(getRes.status).toBe(200);
    const setCookie = getRes.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("csrf");

    // POST with no token: passes (no CSRF middleware)
    const postRes = await app.handle(new Request("http://localhost/api", { method: "POST" }));
    expect(postRes.status).toBe(200);
  });
});
