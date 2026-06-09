import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Headers } from "../src/decorators/params.decorator";
import { Dto, IsString, MinLength } from "../src/schema";

// ─── Auth Headers DTO ─────────────────────────────────────────────────────────

@Dto()
class AuthHeaders {
  @IsString()
  @MinLength(10)
  "x-api-key"!: string;
}

describe("@Headers(DtoClass) — header DTO validation", () => {
  test("valid request with correct header → 200", async () => {
    @Controller("hdr-ok")
    class HdrOkController {
      @Get("/")
      handle(@Headers(AuthHeaders) h: AuthHeaders) {
        return { key: h["x-api-key"] };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrOkController],
      logger: false,
    });

    const res = await app.handle(
      new Request("http://localhost/hdr-ok", {
        headers: { "x-api-key": "my-long-api-key" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe("my-long-api-key");
  });

  test("missing required header → 422 problem+json", async () => {
    @Controller("hdr-missing")
    class HdrMissingController {
      @Get("/")
      handle(@Headers(AuthHeaders) h: AuthHeaders) {
        return { key: h["x-api-key"] };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrMissingController],
      logger: false,
    });

    const res = await app.handle(new Request("http://localhost/hdr-missing"));
    expect(res.status).toBe(422);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("problem+json");
  });

  test("header value too short → 422", async () => {
    @Controller("hdr-short")
    class HdrShortController {
      @Get("/")
      handle(@Headers(AuthHeaders) h: AuthHeaders) {
        return { key: h["x-api-key"] };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrShortController],
      logger: false,
    });

    // "shortkey" is 8 chars, minLength is 10
    const res = await app.handle(
      new Request("http://localhost/hdr-short", {
        headers: { "x-api-key": "shortkey" },
      }),
    );
    expect(res.status).toBe(422);
  });

  test("extra headers (host, accept, user-agent) are tolerated", async () => {
    @Controller("hdr-extra")
    class HdrExtraController {
      @Get("/")
      handle(@Headers(AuthHeaders) h: AuthHeaders) {
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrExtraController],
      logger: false,
    });

    // Standard request always carries host + accept + content-type; these
    // must NOT be rejected by the header schema.
    const res = await app.handle(
      new Request("http://localhost/hdr-extra", {
        headers: {
          "x-api-key": "valid-api-key-1234",
          accept: "application/json",
          "user-agent": "bun-test/1.0",
        },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("header name is case-insensitive (X-Api-Key → x-api-key)", async () => {
    @Controller("hdr-case")
    class HdrCaseController {
      @Get("/")
      handle(@Headers(AuthHeaders) h: AuthHeaders) {
        return { key: h["x-api-key"] };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrCaseController],
      logger: false,
    });

    // HTTP headers are case-insensitive; Elysia normalises to lowercase.
    // Sending "X-Api-Key" should map to "x-api-key" in the DTO.
    const res = await app.handle(
      new Request("http://localhost/hdr-case", {
        // Bun's Request will normalise header names to lowercase internally.
        headers: { "X-Api-Key": "valid-api-key-xyz" },
      }),
    );
    expect(res.status).toBe(200);
  });

  test("@Headers() without DTO still returns all headers", async () => {
    @Controller("hdr-plain")
    class HdrPlainController {
      @Get("/")
      handle(@Headers() h: Record<string, string>) {
        return { hasHost: "host" in h || h["host"] !== undefined };
      }
    }

    const app = await TechneFactory.create({
      controllers: [HdrPlainController],
      logger: false,
    });

    const res = await app.handle(new Request("http://localhost/hdr-plain"));
    expect(res.status).toBe(200);
  });
});
