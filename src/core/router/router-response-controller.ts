import { HttpException, REASON_PHRASES } from "../../exceptions";

/** RFC 7807 problem document, plus optional extension fields. */
export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  instance?: string;
  requestId?: string;
  errors?: unknown;
  [key: string]: unknown;
}

const PROBLEM_TYPE_BASE = "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/";
const ABOUT_BLANK = "about:blank";

/**
 * Maps thrown values from controller / pipe / guard / interceptor pipelines
 * into HTTP responses.
 *
 * Output format is RFC 7807 (`application/problem+json`):
 *
 *   {
 *     "type":      "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found.md" | "about:blank",
 *     "title":     "Not Found",
 *     "status":    404,
 *     "detail":    "User #99 not found",
 *     "code":      "user.not_found",      // optional, from HttpException.options.code
 *     "instance":  "/users/99",            // request URL path
 *     "requestId": "<uuid>",               // from context.store.requestId
 *     "errors":    [ ValidationError... ]  // 422 ValidationError[] extension
 *   }
 *
 * The `detail` field is omitted in production for non-HttpException throws so
 * server-side error messages never leak to clients.
 */
export class RouterResponseController {
  public mapException(context: any, error: unknown): ProblemDocument {
    const isProduction = (Bun?.env?.NODE_ENV ?? process.env.NODE_ENV) === "production";
    const instance = this.getInstance(context);
    const requestId = this.getRequestId(context);

    // Validation errors from src/schema/dto.ts come through as an array of
    // ValidationError objects (or as a JSON-stringified array wrapped in a
    // BadRequestException by ValidationPipe). The pipe path is already
    // covered by the HttpException branch below; this branch handles the
    // case where raw ValidationError[] is thrown.
    if (Array.isArray(error) && this.isValidationErrorArray(error)) {
      const body = this.buildProblem({
        status: 422,
        title: REASON_PHRASES[422]!,
        detail: "Validation failed",
        slug: "unprocessable-entity",
        instance,
        requestId,
      });
      body.errors = error;
      this.applyResponse(context, 422, body);
      return body;
    }

    if (error instanceof HttpException) {
      const status = error.getStatus();
      const title = REASON_PHRASES[status] ?? error.error ?? "Error";
      const detail = error.message || undefined;
      const explicitType = error.options?.type;
      const slug = explicitType ? undefined : this.slugify(title);
      const body = this.buildProblem({
        status,
        title,
        detail,
        slug,
        type: explicitType,
        code: error.options?.code,
        instance,
        requestId,
      });
      // 422 extension: ValidationPipe stringifies ValidationError[] into the
      // BadRequestException message. If callers throw an HttpException with
      // an object payload that includes `errors`, surface them.
      const response = error.getResponse();
      if (
        status === 422 &&
        response &&
        typeof response === "object" &&
        "errors" in response &&
        Array.isArray((response as any).errors)
      ) {
        body.errors = (response as any).errors;
      }
      this.applyResponse(context, status, body);
      return body;
    }

    if (error instanceof Error) {
      const body = this.buildProblem({
        status: 500,
        title: REASON_PHRASES[500]!,
        detail: isProduction ? undefined : error.message || undefined,
        slug: "internal-server-error",
        instance,
        requestId,
      });
      this.applyResponse(context, 500, body);
      return body;
    }

    // Non-Error throws: strings, numbers, objects, etc.
    const body = this.buildProblem({
      status: 500,
      title: REASON_PHRASES[500]!,
      detail: isProduction ? undefined : String(error),
      slug: "internal-server-error",
      instance,
      requestId,
    });
    this.applyResponse(context, 500, body);
    return body;
  }

  private buildProblem(args: {
    status: number;
    title: string;
    detail?: string;
    slug?: string;
    type?: string;
    code?: string;
    instance?: string;
    requestId?: string;
  }): ProblemDocument {
    const type = args.type ?? (args.slug ? `${PROBLEM_TYPE_BASE}${args.slug}.md` : ABOUT_BLANK);
    const body: ProblemDocument = {
      type,
      title: args.title,
      status: args.status,
    };
    if (args.detail !== undefined) body.detail = args.detail;
    if (args.code !== undefined) body.code = args.code;
    if (args.instance !== undefined) body.instance = args.instance;
    if (args.requestId !== undefined) body.requestId = args.requestId;
    return body;
  }

  private applyResponse(context: any, status: number, _body: ProblemDocument): void {
    if (!context || !context.set) return;
    context.set.status = status;
    const existing = context.set.headers ?? {};
    if (existing instanceof Headers) {
      existing.set("content-type", "application/problem+json");
      context.set.headers = existing;
    } else {
      context.set.headers = {
        ...(existing as Record<string, string>),
        "content-type": "application/problem+json",
      };
    }
  }

  private getInstance(context: any): string | undefined {
    const url: string | undefined = context?.request?.url ?? context?.url;
    if (!url) return undefined;
    try {
      return new URL(url).pathname;
    } catch {
      // Fall back to raw URL; mapException must never throw.
      return url;
    }
  }

  private getRequestId(context: any): string | undefined {
    const fromStore = context?.store?.requestId;
    if (typeof fromStore === "string" && fromStore.length > 0) return fromStore;
    const fromHeader = context?.request?.headers?.get?.("x-request-id");
    return typeof fromHeader === "string" && fromHeader.length > 0 ? fromHeader : undefined;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private isValidationErrorArray(value: unknown[]): boolean {
    if (value.length === 0) return false;
    return value.every(
      (item) =>
        !!item &&
        typeof item === "object" &&
        "property" in (item as object) &&
        typeof (item as { property: unknown }).property === "string",
    );
  }
}
