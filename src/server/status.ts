/** HTTP status names (RFC 9110 and friends) mapped to their codes. */
export const StatusMap = {
  Continue: 100,
  "Switching Protocols": 101,
  Processing: 102,
  "Early Hints": 103,
  OK: 200,
  Created: 201,
  Accepted: 202,
  "Non-Authoritative Information": 203,
  "No Content": 204,
  "Reset Content": 205,
  "Partial Content": 206,
  "Multi-Status": 207,
  "Already Reported": 208,
  "Multiple Choices": 300,
  "Moved Permanently": 301,
  Found: 302,
  "See Other": 303,
  "Not Modified": 304,
  "Temporary Redirect": 307,
  "Permanent Redirect": 308,
  "Bad Request": 400,
  Unauthorized: 401,
  "Payment Required": 402,
  Forbidden: 403,
  "Not Found": 404,
  "Method Not Allowed": 405,
  "Not Acceptable": 406,
  "Proxy Authentication Required": 407,
  "Request Timeout": 408,
  Conflict: 409,
  Gone: 410,
  "Length Required": 411,
  "Precondition Failed": 412,
  "Payload Too Large": 413,
  "URI Too Long": 414,
  "Unsupported Media Type": 415,
  "Range Not Satisfiable": 416,
  "Expectation Failed": 417,
  "I'm a teapot": 418,
  "Misdirected Request": 421,
  "Unprocessable Content": 422,
  Locked: 423,
  "Failed Dependency": 424,
  "Too Early": 425,
  "Upgrade Required": 426,
  "Precondition Required": 428,
  "Too Many Requests": 429,
  "Request Header Fields Too Large": 431,
  "Unavailable For Legal Reasons": 451,
  "Internal Server Error": 500,
  "Not Implemented": 501,
  "Bad Gateway": 502,
  "Service Unavailable": 503,
  "Gateway Timeout": 504,
  "HTTP Version Not Supported": 505,
  "Variant Also Negotiates": 506,
  "Insufficient Storage": 507,
  "Loop Detected": 508,
  "Not Extended": 510,
  "Network Authentication Required": 511,
} as const;

export type StatusMap = typeof StatusMap;
export type StatusName = keyof StatusMap;
export type StatusCode = number | StatusName;
/** Numeric code for a status number or name. */
export type NumericStatus<C extends StatusCode> = C extends StatusName ? StatusMap[C] : C;

/** Reason phrase for each code: the inverse of {@link StatusMap}. */
export const StatusText: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(StatusMap).map(([name, code]) => [code, name]),
);

/** Statuses that must not carry a body. */
const EMPTY_BODY = new Set([101, 204, 205, 304]);
export const isEmptyBodyStatus = (code: number) => EMPTY_BODY.has(code);

export const toStatusCode = (code: StatusCode): number =>
  typeof code === "number" ? code : (StatusMap[code] ?? 500);

export const PROBLEM_JSON = "application/problem+json";

/** A response value with an explicit status, produced by {@link status} and {@link problem}. */
export class StatusResult<const Code extends number = number, const Body = unknown> {
  readonly code: Code;
  readonly response: Body;
  readonly headers: Record<string, string> | undefined;

  constructor(code: Code, response: Body, headers?: Record<string, string>) {
    this.code = code;
    this.response = isEmptyBodyStatus(code) ? (undefined as Body) : response;
    this.headers = headers;
  }

  get status(): Code {
    return this.code;
  }
}

/** Return (or throw) a value with an explicit HTTP status. */
export function status<const C extends StatusCode, T = undefined>(
  code: C,
  response?: T,
): StatusResult<NumericStatus<C>, T extends undefined ? string : T> {
  const numeric = toStatusCode(code) as NumericStatus<C>;
  return new StatusResult(numeric, (response ?? StatusText[numeric] ?? String(numeric)) as any);
}

/** RFC 9457 problem details. */
export type Problem<C extends StatusCode = StatusCode, Extension extends object = {}> = {
  /** URI or slug identifying the problem type. Defaults to `about:blank`. */
  type?: string;
  title?: string;
  status?: C;
  detail?: string;
  instance?: string;
} & Extension;

export type ProblemBody<S extends number, P> = {
  type: string;
  title: string;
  status: S;
  detail?: string;
  instance?: string;
} & Omit<P, keyof Problem>;

/** Normalises problem details into the RFC 9457 body Techne sends. */
export function problemBody(p: Problem): Record<string, unknown> & { status: number } {
  const code = p.status === undefined ? 500 : toStatusCode(p.status);
  const body: Record<string, unknown> & { status: number } = {
    type: "about:blank",
    ...p,
    status: code,
  };
  if (body.title == null) body.title = StatusText[code] ?? "Error";
  return body;
}

const PROBLEM_HEADERS = Object.freeze({ "content-type": PROBLEM_JSON }) as Record<string, string>;

/** RFC 9457 problem response: `problem(404, { detail })` or `problem({ status, ... })`. */
export function problem<const C extends StatusCode, const P extends object = {}>(
  status: C,
  detail?: P & Omit<Problem, "status">,
): StatusResult<NumericStatus<C>, ProblemBody<NumericStatus<C>, P>>;
export function problem<const P extends Problem>(
  detail: P,
): StatusResult<
  P extends { status: infer S extends StatusCode } ? NumericStatus<S> : 500,
  ProblemBody<P extends { status: infer S extends StatusCode } ? NumericStatus<S> : 500, P>
>;
export function problem(statusOrDetail: StatusCode | Problem, detail?: Problem): StatusResult {
  const p =
    typeof statusOrDetail === "object" ? statusOrDetail : { ...detail, status: statusOrDetail };
  const body = problemBody(p);
  return new StatusResult(body.status, body, PROBLEM_HEADERS);
}

export function problemResponse(p: Problem, headers?: Record<string, string>): Response {
  const body = problemBody(p);
  return new Response(isEmptyBodyStatus(body.status) ? null : JSON.stringify(body), {
    status: body.status,
    headers: headers ? { ...headers, "content-type": PROBLEM_JSON } : PROBLEM_HEADERS,
  });
}

const isProduction = () => (Bun.env.NODE_ENV ?? "") === "production";

/** Base class for the errors the server raises itself. */
export class HttpError extends Error {
  readonly status: number;
  readonly problemType: string;

  constructor(status: number, problemType: string, message?: string, cause?: unknown) {
    super(message ?? StatusText[status] ?? "Error", cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.status = status;
    this.problemType = problemType;
  }

  toResponse(headers?: Record<string, string>): Response {
    const title = StatusText[this.status];
    return problemResponse(
      {
        type: this.problemType,
        title,
        status: this.status,
        detail: this.message !== title ? this.message : undefined,
      },
      headers,
    );
  }
}

export class NotFoundError extends HttpError {
  constructor(message?: string) {
    super(404, "not-found", message);
  }
}

export class ParseError extends HttpError {
  constructor(cause?: unknown) {
    super(400, "parse", "Bad Request", cause);
  }

  override toResponse(headers?: Record<string, string>): Response {
    const cause = this.cause as { message?: unknown } | undefined;
    return problemResponse(
      {
        type: this.problemType,
        title: "Bad Request",
        status: 400,
        detail: !isProduction() && cause?.message != null ? String(cause.message) : undefined,
      },
      headers,
    );
  }
}

/** An issue reported by schema validation. */
export interface ValidationIssue {
  instancePath: string;
  message: string;
  keyword?: string;
  schemaPath?: string;
  params?: unknown;
}

export type ValidationTarget = "body" | "query" | "params" | "headers" | "cookie" | "response";

/** Thrown when a request part fails its schema. Maps to a 422 problem document. */
export class ValidationError extends HttpError {
  readonly type: ValidationTarget;
  readonly value: unknown;
  readonly errors: ValidationIssue[];

  constructor(type: ValidationTarget, value: unknown, errors: ValidationIssue[]) {
    super(422, "validation", errors[0]?.message ?? `Validation error on ${type}`);
    this.type = type;
    this.value = value;
    this.errors = errors;
  }

  /** Alias of {@link errors}. */
  get all(): ValidationIssue[] {
    return this.errors;
  }

  override toResponse(headers?: Record<string, string>): Response {
    const first = this.errors[0];
    return problemResponse(
      {
        type: "validation",
        title: "Validation Error",
        status: 422,
        detail: this.message,
        on: this.type,
        property: first?.instancePath || "root",
        errors: this.errors,
      } as Problem,
      headers,
    );
  }
}

/** Default 500 problem document; `detail` and `name` only outside production. */
export function internalServerErrorResponse(error: unknown): Response {
  const body: Record<string, unknown> = {
    type: "internal-server-error",
    title: "Internal Server Error",
    status: 500,
  };
  if (!isProduction() && error instanceof Error) {
    body.detail = error.message;
    body.name = error.name;
  }
  return new Response(JSON.stringify(body), { status: 500, headers: PROBLEM_HEADERS });
}
