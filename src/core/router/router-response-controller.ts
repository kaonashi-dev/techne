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

const STATUS_SLUG: Record<number, string> = {
  400: "bad-request",
  401: "unauthorized",
  403: "forbidden",
  404: "not-found",
  405: "method-not-allowed",
  409: "conflict",
  410: "gone",
  422: "unprocessable-entity",
  429: "too-many-requests",
  500: "internal-server-error",
  501: "not-implemented",
  502: "bad-gateway",
  503: "service-unavailable",
};

// B5: cache the production-env lookup once at module load. The lookup itself
// is cheap, but the mapException path runs per error and avoiding the repeated
// env access keeps the hot error path allocation-free of property reads.
let IS_PRODUCTION = (Bun?.env?.NODE_ENV ?? process.env.NODE_ENV) === "production";

/**
 * Test-only setter for the cached `IS_PRODUCTION` flag.
 *
 * Production code reads `IS_PRODUCTION` once at module load. Tests that flip
 * `NODE_ENV` at runtime (see `tests/error-contract.test.ts`) need this hook to
 * keep the cached value in sync. Do not call from production code.
 */
export function __setIsProduction(value: boolean): void {
  IS_PRODUCTION = value;
}

/**
 * B6: per-(status, slug) cache of RFC 7807 problem templates and headers.
 *
 * The base problem object only depends on `(status, title, type)`, all of
 * which are derived from `(status, slug-or-explicit-type)`. Caching a frozen
 * base lets the hot path do a single shallow copy plus dynamic-field
 * assignment per error, instead of allocating the literal + computing the
 * type URL each time.
 *
 * Headers are cached alongside as a frozen template. Downstream hooks
 * (`echoRequestId`, CORS) mutate `set.headers`, so `applyResponse` must clone
 * before assigning — the cache saves the literal allocation, not the clone.
 */
interface ProblemTemplate {
  base: Readonly<ProblemDocument>;
  headers: Readonly<Record<string, string>>;
}
// The headers value is identical across every (status, slug) pair — only
// `content-type` is set — so we share a single frozen instance rather than
// allocating one per cache entry. `applyResponse` still spreads it into a
// fresh object because downstream hooks mutate `set.headers` in place.
const PROBLEM_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/problem+json",
});
const PROBLEM_TEMPLATE_CACHE = new Map<string, ProblemTemplate>();

function getProblemTemplate(
  status: number,
  title: string,
  slug: string | undefined,
  explicitType: string | undefined,
): ProblemTemplate {
  // Key shape: `${status}|${type-or-slug}`. Explicit types short-circuit slug
  // resolution; otherwise the slug (already canonical via STATUS_SLUG or
  // slugify) is sufficient. `|` separator avoids ambiguity since neither
  // status nor slugs contain it.
  const typeKey = explicitType ?? slug ?? "";
  const key = `${status}|${typeKey}`;
  const cached = PROBLEM_TEMPLATE_CACHE.get(key);
  if (cached !== undefined) return cached;
  const type = explicitType ?? (slug ? `${PROBLEM_TYPE_BASE}${slug}.md` : ABOUT_BLANK);
  const entry: ProblemTemplate = {
    base: Object.freeze({ type, title, status }) as Readonly<ProblemDocument>,
    headers: PROBLEM_HEADERS,
  };
  PROBLEM_TEMPLATE_CACHE.set(key, entry);
  return entry;
}

/**
 * Maps thrown values from controller / guard / pipe / interceptor pipelines
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
    const isProduction = IS_PRODUCTION;
    const instance = this.getInstance(context);
    const requestId = this.getRequestId(context);

    // Compatibility branch for callers that throw raw ValidationError[] from
    // custom pipes or filters. Route DTO validation itself is handled by
    // Elysia before handlers run.
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
      const slug = explicitType ? undefined : (STATUS_SLUG[status] ?? this.slugify(title));
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
      // 422 extension: if callers throw an HttpException with an object
      // payload that includes `errors`, surface them.
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
    // B6: pull a frozen base from the per-(status, slug-or-type) cache and
    // shallow-copy it. The base owns `(type, title, status)`; only dynamic
    // fields are assigned below.
    const template = getProblemTemplate(args.status, args.title, args.slug, args.type);
    const body: ProblemDocument = { ...template.base };
    if (args.detail !== undefined) body.detail = args.detail;
    if (args.code !== undefined) body.code = args.code;
    if (args.instance !== undefined) body.instance = args.instance;
    if (args.requestId !== undefined) body.requestId = args.requestId;
    return body;
  }

  private applyResponse(context: any, status: number, _body: ProblemDocument): void {
    if (!context || !context.set) return;
    context.set.status = status;
    const existing = context.set.headers;
    if (existing instanceof Headers) {
      existing.set("content-type", "application/problem+json");
      context.set.headers = existing;
      return;
    }
    // B6: spread the shared frozen header template. We must allocate a fresh
    // object because downstream hooks (`echoRequestId`, CORS) mutate
    // `set.headers` in place — the cache saves the string-literal allocation
    // and the per-template Object.freeze, not the spread itself.
    if (existing == null) {
      context.set.headers = { ...PROBLEM_HEADERS };
    } else {
      context.set.headers = {
        ...(existing as Record<string, string>),
        ...PROBLEM_HEADERS,
      };
    }
  }

  private getInstance(context: any): string | undefined {
    const url: string | undefined = context?.request?.url ?? context?.url;
    if (!url) return undefined;
    const protocolEnd = url.indexOf("://");
    if (protocolEnd === -1) return url;
    const pathStart = url.indexOf("/", protocolEnd + 3);
    if (pathStart === -1) return "/";
    const queryStart = url.indexOf("?", pathStart);
    const hashStart = url.indexOf("#", pathStart);
    const end =
      queryStart !== -1 && (hashStart === -1 || queryStart < hashStart)
        ? queryStart
        : hashStart !== -1
          ? hashStart
          : url.length;
    return url.slice(pathStart, end) || "/";
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
