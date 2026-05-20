import { describe, expect, test } from "bun:test";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  REASON_PHRASES,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
} from "../src/exceptions";

type Ctor = new (message?: string) => HttpException;

const cases: Array<{
  ctor: Ctor;
  status: number;
  reason: string;
  defaultMessage: string;
}> = [
  { ctor: BadRequestException, status: 400, reason: "Bad Request", defaultMessage: "Bad Request" },
  {
    ctor: UnauthorizedException,
    status: 401,
    reason: "Unauthorized",
    defaultMessage: "Unauthorized",
  },
  {
    ctor: ForbiddenException,
    status: 403,
    reason: "Forbidden",
    defaultMessage: "Forbidden resource",
  },
  { ctor: NotFoundException, status: 404, reason: "Not Found", defaultMessage: "Not Found" },
  { ctor: ConflictException, status: 409, reason: "Conflict", defaultMessage: "Conflict" },
  { ctor: GoneException, status: 410, reason: "Gone", defaultMessage: "Gone" },
  {
    ctor: UnprocessableEntityException,
    status: 422,
    reason: "Unprocessable Entity",
    defaultMessage: "Unprocessable Entity",
  },
  {
    ctor: TooManyRequestsException,
    status: 429,
    reason: "Too Many Requests",
    defaultMessage: "Too Many Requests",
  },
  {
    ctor: InternalServerErrorException,
    status: 500,
    reason: "Internal Server Error",
    defaultMessage: "Internal Server Error",
  },
  {
    ctor: ServiceUnavailableException,
    status: 503,
    reason: "Service Unavailable",
    defaultMessage: "Service Unavailable",
  },
];

describe("HTTP exception subclasses", () => {
  for (const { ctor, status, reason, defaultMessage } of cases) {
    test(`${ctor.name} has status ${status} and reason "${reason}"`, () => {
      const ex = new ctor();
      expect(ex).toBeInstanceOf(HttpException);
      expect(ex).toBeInstanceOf(Error);
      expect(ex.getStatus()).toBe(status);
      expect(ex.statusCode).toBe(status);
      expect(ex.error).toBe(reason);
      expect(ex.message).toBe(defaultMessage);
      expect(REASON_PHRASES[status]).toBe(reason);
      expect(ex.name).toBe(ctor.name);
    });

    test(`${ctor.name} accepts a custom message`, () => {
      const ex = new ctor("custom detail");
      expect(ex.message).toBe("custom detail");
      expect(ex.getStatus()).toBe(status);
      expect(ex.error).toBe(reason);
      const body = ex.toJSON() as { statusCode: number; message: string; error: string };
      expect(body.statusCode).toBe(status);
      expect(body.message).toBe("custom detail");
      expect(body.error).toBe(reason);
    });

    test(`${ctor.name} accepts options for RFC 7807 code/type`, () => {
      const ex = new ctor("oops" as unknown as string);
      expect(ex.options).toEqual({});
      // Subclasses accept an optional `options` arg as second parameter.
      const SubCtor = ctor as unknown as new (
        message?: string,
        options?: { code?: string; type?: string },
      ) => HttpException;
      const withOpts = new SubCtor("oops", {
        code: "x.y",
        type: "https://example.com/types/x",
      });
      expect(withOpts.options.code).toBe("x.y");
      expect(withOpts.options.type).toBe("https://example.com/types/x");
      // error reason should still be the canonical reason phrase even when options provided
      expect(withOpts.error).toBe(reason);
      expect(withOpts.getStatus()).toBe(status);
    });
  }
});

describe("HttpException structured signature", () => {
  test("accepts (response, status, options) with string response", () => {
    const ex = new HttpException("nope", 418, {
      code: "teapot.refused",
      type: "https://example.com/teapot",
    });
    expect(ex.getStatus()).toBe(418);
    expect(ex.message).toBe("nope");
    expect(ex.error).toBe(REASON_PHRASES[418]);
    expect(ex.options.code).toBe("teapot.refused");
    expect(ex.options.type).toBe("https://example.com/teapot");
    const body = ex.getResponse() as { statusCode: number; message: string; error: string };
    expect(body.statusCode).toBe(418);
    expect(body.message).toBe("nope");
  });

  test("accepts (response, status, options) with object response", () => {
    const ex = new HttpException(
      { message: "complex", error: "Custom Reason", extra: "info" },
      422,
      { code: "validation.failed" },
    );
    expect(ex.getStatus()).toBe(422);
    expect(ex.message).toBe("complex");
    expect(ex.error).toBe("Custom Reason");
    expect(ex.options.code).toBe("validation.failed");
    expect(ex.getResponse()).toEqual({
      statusCode: 422,
      message: "complex",
      error: "Custom Reason",
      extra: "info",
    });
  });

  test("REASON_PHRASES covers every status used by the subclasses", () => {
    for (const { status, reason } of cases) {
      expect(REASON_PHRASES[status]).toBe(reason);
    }
  });

  test("legacy signature (statusCode, message, error) still works", () => {
    const ex = new HttpException(418, "short and stout", "Teapot");
    expect(ex.getStatus()).toBe(418);
    expect(ex.message).toBe("short and stout");
    expect(ex.error).toBe("Teapot");
    expect(ex.toJSON()).toEqual({
      statusCode: 418,
      message: "short and stout",
      error: "Teapot",
    });
  });
});
