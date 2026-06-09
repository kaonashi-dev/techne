import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Body } from "../src/decorators/params.decorator";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { NotFoundException } from "../src/exceptions";
import { Dto, IsString } from "../src/schema";
import { compileSecurityHeaders } from "../src/security";

const PRESET_HEADER_NAMES = [
  "x-content-type-options",
  "x-frame-options",
  "strict-transport-security",
  "referrer-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "x-permitted-cross-domain-policies",
] as const;

@Controller("widgets")
class WidgetsController {
  @Get("/")
  list() {
    return { widgets: [] };
  }

  @Get("/missing")
  missing() {
    throw new NotFoundException("Widget not found");
  }
}

describe("compileSecurityHeaders()", () => {
  test("true yields the full preset with defaults", () => {
    const headers = compileSecurityHeaders(true);
    expect(headers).toEqual({
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "strict-transport-security": "max-age=15552000; includeSubDomains",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-origin",
      "x-permitted-cross-domain-policies": "none",
    });
    expect(Object.isFrozen(headers)).toBe(true);
  });

  test("per-header overrides and disables", () => {
    const headers = compileSecurityHeaders({
      frameOptions: "DENY",
      hsts: { maxAge: 100, includeSubDomains: false, preload: true },
      referrerPolicy: "same-origin",
      contentTypeOptions: false,
      permittedCrossDomainPolicies: false,
    });
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toBe("max-age=100; preload");
    expect(headers["referrer-policy"]).toBe("same-origin");
    expect(headers["x-content-type-options"]).toBeUndefined();
    expect(headers["x-permitted-cross-domain-policies"]).toBeUndefined();
  });

  test("CSP accepts a string or a directive map; absent by default", () => {
    expect(compileSecurityHeaders(true)["content-security-policy"]).toBeUndefined();
    expect(
      compileSecurityHeaders({ contentSecurityPolicy: "default-src 'none'" })[
        "content-security-policy"
      ],
    ).toBe("default-src 'none'");
    expect(
      compileSecurityHeaders({
        contentSecurityPolicy: {
          "default-src": "'self'",
          "img-src": ["'self'", "data:"],
          "upgrade-insecure-requests": "",
        },
      })["content-security-policy"],
    ).toBe("default-src 'self'; img-src 'self' data:; upgrade-insecure-requests");
  });

  test("custom entries merge last and override preset headers", () => {
    const headers = compileSecurityHeaders({
      custom: { "X-Frame-Options": "DENY", "x-powered-by": "techne" },
    });
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-powered-by"]).toBe("techne");
  });
});

describe("securityHeaders option — response stamping", () => {
  test("preset headers on a 200 response", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: true,
    });
    const res = await app.handle(new Request("http://localhost/widgets"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=15552000; includeSubDomains",
    );
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(res.headers.get("x-permitted-cross-domain-policies")).toBe("none");
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  test("headers on a thrown-exception response (problem+json)", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: true,
    });
    const res = await app.handle(new Request("http://localhost/widgets/missing"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBe(
      "max-age=15552000; includeSubDomains",
    );
  });

  test("headers on an unknown-route 404 (Elysia onError path)", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: true,
    });
    const res = await app.handle(new Request("http://localhost/nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  test("headers on a 422 validation error", async () => {
    @Dto()
    class CreateWidgetDto {
      @IsString()
      name!: string;
    }

    @Controller("v-widgets")
    class ValidatedWidgetsController {
      @Post("/")
      create(@Body(CreateWidgetDto) body: CreateWidgetDto) {
        return body;
      }
    }

    const app = await TechneFactory.create({
      controllers: [ValidatedWidgetsController],
      logger: false,
      securityHeaders: true,
    });
    const res = await app.handle(
      new Request("http://localhost/v-widgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      }),
    );
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("request-id echo still works alongside security headers", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: true,
    });
    const res = await app.handle(
      new Request("http://localhost/widgets", { headers: { "x-request-id": "corr-1" } }),
    );
    expect(res.headers.get("x-request-id")).toBe("corr-1");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("coexists with CORS headers", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: true,
      cors: { origin: "https://app.example.com" },
    });
    const res = await app.handle(
      new Request("http://localhost/widgets", {
        headers: { origin: "https://app.example.com" },
      }),
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("options object tunes individual headers end-to-end", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: {
        frameOptions: "DENY",
        hsts: false,
        contentSecurityPolicy: { "default-src": "'none'" },
      },
    });
    const res = await app.handle(new Request("http://localhost/widgets"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  test("zero-cost contract: no headers when the option is absent", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
    });
    const ok = await app.handle(new Request("http://localhost/widgets"));
    const notFound = await app.handle(new Request("http://localhost/nope"));
    for (const res of [ok, notFound]) {
      for (const name of PRESET_HEADER_NAMES) {
        expect(res.headers.get(name)).toBeNull();
      }
    }
  });

  test("securityHeaders: false behaves like absent", async () => {
    const app = await TechneFactory.create({
      controllers: [WidgetsController],
      logger: false,
      securityHeaders: false,
    });
    const res = await app.handle(new Request("http://localhost/widgets"));
    for (const name of PRESET_HEADER_NAMES) {
      expect(res.headers.get(name)).toBeNull();
    }
  });
});
