/**
 * Standard reason-phrase lookup for HTTP status codes.
 *
 * Used by the RFC 7807 error contract in
 * {@link RouterResponseController.mapException} to derive the `title` field.
 * Consumers may also import this directly to render reason phrases.
 */
export const REASON_PHRASES: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  422: "Unprocessable Entity",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
};

/**
 * Optional metadata attached to an {@link HttpException}.
 *
 * - `code`: stable machine-readable error code (e.g. `"user.not_found"`).
 *   Surfaced as the `code` field of the RFC 7807 problem document.
 * - `type`: a URI reference identifying the problem type. When omitted, the
 *   response controller derives one from the status (`https://github.com/kaonashi-dev/techne/blob/main/docs/errors/<slug>.md`).
 */
export interface HttpExceptionOptions {
  code?: string;
  type?: string;
}

/**
 * NestJS-compatible HttpException.
 *
 * Accepts two constructor signatures:
 *
 *   new HttpException(response, status, options?)             // NestJS-style
 *     - response: string | object
 *     - status: number
 *     - options?: HttpExceptionOptions
 *
 *   new HttpException(statusCode, message, error?)            // Legacy Bnest-style
 *     - statusCode: number
 *     - message: string
 *     - error?: string  (defaults to "Error")
 *
 * Subclasses (e.g. NotFoundException) accept an optional `options` arg as a
 * second parameter to attach `code` / `type` for the RFC 7807 contract.
 *
 * The two top-level signatures are distinguished by the type of the first
 * argument. The legacy form is still used by every built-in subclass in
 * `http-errors.ts`, so both must keep working.
 */
export class HttpException extends Error {
  public statusCode: number;
  public error: string;
  public readonly options: HttpExceptionOptions;
  private readonly responseBody: string | object;

  constructor(
    statusCodeOrResponse: number | string | object,
    statusOrMessage?: number | string,
    errorOrOptions?: string | HttpExceptionOptions,
  ) {
    if (typeof statusCodeOrResponse === "number") {
      // Legacy Bnest signature: (statusCode, message, errorOrOptions?)
      // `errorOrOptions` is normally a string (the reason phrase). For
      // forward-compat we also accept an HttpExceptionOptions object here so
      // callers using the legacy signature can still attach `code`/`type`.
      const message = typeof statusOrMessage === "string" ? statusOrMessage : "";
      super(message);
      this.statusCode = statusCodeOrResponse;
      if (typeof errorOrOptions === "string") {
        this.error = errorOrOptions;
        this.options = {};
      } else if (errorOrOptions && typeof errorOrOptions === "object") {
        this.error = REASON_PHRASES[this.statusCode] ?? "Error";
        this.options = errorOrOptions;
      } else {
        this.error = "Error";
        this.options = {};
      }
      this.responseBody = {
        statusCode: this.statusCode,
        message,
        error: this.error,
      };
    } else {
      // NestJS signature: (response, status, options?)
      const status = typeof statusOrMessage === "number" ? statusOrMessage : 500;
      const message =
        typeof statusCodeOrResponse === "string"
          ? statusCodeOrResponse
          : (extractMessage(statusCodeOrResponse) ?? "");
      super(message);
      this.statusCode = status;
      this.error = extractError(statusCodeOrResponse) ?? REASON_PHRASES[status] ?? "Error";
      this.options =
        errorOrOptions && typeof errorOrOptions === "object" ? errorOrOptions : {};
      this.responseBody =
        typeof statusCodeOrResponse === "object" && statusCodeOrResponse !== null
          ? { statusCode: status, ...statusCodeOrResponse }
          : { statusCode: status, message, error: this.error };
    }

    this.name = this.constructor.name;
  }

  /** NestJS-compatible: returns the HTTP status code. */
  public getStatus(): number {
    return this.statusCode;
  }

  /**
   * NestJS-compatible: returns the response body that should be serialized.
   * If the exception was built with an object payload, that payload is
   * returned directly (with `statusCode` merged in).
   */
  public getResponse(): string | object {
    return this.responseBody;
  }

  public toJSON() {
    return this.responseBody;
  }
}

function extractMessage(value: unknown): string | undefined {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

function extractError(value: unknown): string | undefined {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  return undefined;
}
