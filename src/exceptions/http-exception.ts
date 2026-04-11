/**
 * NestJS-compatible HttpException.
 *
 * Accepts two constructor signatures:
 *
 *   new HttpException(response, status)             // NestJS-style
 *     - response: string | object
 *     - status: number
 *
 *   new HttpException(statusCode, message, error?)  // Legacy Bnest-style
 *     - statusCode: number
 *     - message: string
 *     - error?: string  (defaults to "Error")
 *
 * The two signatures are distinguished by the type of the first argument. The
 * legacy form is still used by every built-in subclass in `http-errors.ts`, so
 * both must keep working.
 */
export class HttpException extends Error {
  public statusCode: number;
  public error: string;
  private readonly responseBody: string | object;

  constructor(
    statusCodeOrResponse: number | string | object,
    statusOrMessage?: number | string,
    error?: string,
  ) {
    if (typeof statusCodeOrResponse === "number") {
      // Legacy Bnest signature: (statusCode, message, error?)
      const message = typeof statusOrMessage === "string" ? statusOrMessage : "";
      super(message);
      this.statusCode = statusCodeOrResponse;
      this.error = error ?? "Error";
      this.responseBody = {
        statusCode: this.statusCode,
        message,
        error: this.error,
      };
    } else {
      // NestJS signature: (response, status)
      const status = typeof statusOrMessage === "number" ? statusOrMessage : 500;
      const message =
        typeof statusCodeOrResponse === "string"
          ? statusCodeOrResponse
          : (extractMessage(statusCodeOrResponse) ?? "");
      super(message);
      this.statusCode = status;
      this.error = extractError(statusCodeOrResponse) ?? "Error";
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
