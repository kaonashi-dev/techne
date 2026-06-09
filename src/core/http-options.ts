export interface GlobalPrefixOptions {
  exclude?: string[];
}

export type VersioningType = "uri" | "header";

export interface VersioningOptions {
  type: VersioningType;
  header?: string;
  prefix?: string | false;
  defaultVersion?: string | string[];
  extractor?: (request: Request) => string | string[] | undefined;
}

export interface CorsOptions {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * Native server limits, forwarded to `Bun.serve` via Elysia's object-form
 * `listen()`. Enforced by the runtime before any framework code runs, so
 * they only apply to real sockets — `app.handle()` (tests, embedded use)
 * bypasses `Bun.serve` entirely.
 */
export interface TechneServerOptions {
  /**
   * Maximum request body size in bytes (Bun default: 128 MiB). Oversized
   * requests are rejected with a native plain-text 413 before parsing —
   * not a problem+json document.
   */
  maxRequestBodySize?: number;
  /**
   * Seconds a connection may sit idle before Bun closes the socket (0–255,
   * Bun default: 10). This is a socket-level idle timeout, not a total
   * request deadline — a handler that streams or computes indefinitely is
   * not interrupted by it.
   */
  idleTimeout?: number;
}

export interface TechneValidationOptions {
  /**
   * When `true`, the validation error response includes every error reported
   * by the schema. When omitted/`false` (default), only the first error is
   * returned.
   */
  exhaustive?: boolean;
  /**
   * When `true`, unknown top-level properties are stripped from the request
   * body instead of rejected. Applies globally to all routes whose body DTO
   * uses a DTO class (whether via `@Body(Dto)` or typed `@Body()`).
   *
   * An explicit per-DTO `@Dto({ stripUnknown })` value overrides this flag in
   * both directions: `true` enables stripping without the global flag, and
   * `false` keeps a DTO strict even when the global flag is on.
   *
   * **Note:** v1 strip-unknown is top-level properties only.
   */
  stripUnknown?: boolean;
}

export interface RouteRegistrationOptions {
  globalPrefix?: {
    prefix: string;
    exclude?: string[];
  };
  versioning?: VersioningOptions;
}

/**
 * Cookie signing configuration passed to the Elysia constructor.
 * Elysia's built-in cookie jar handles signing for cookies listed in `sign`.
 */
export interface CookieOptions {
  /** One or more secrets used to sign cookies (rotated: first is active). */
  secrets?: string | string[];
  /** Names of cookies that should be automatically signed/verified. */
  sign?: string[];
}

/**
 * CSRF double-submit protection configuration.
 * Set to `false` (or omit) to disable completely — zero per-request cost.
 */
export interface FactoryCsrfOptions {
  /** Cookie name for the CSRF token. Defaults to `__Host-csrf` (prod) or `csrf`. */
  cookieName?: string;
  /** Request header carrying the submitted token. Default: `"x-csrf-token"` */
  headerName?: string;
  /** HTTP methods that require a valid CSRF token. Default: POST, PUT, PATCH, DELETE. */
  methods?: string[];
  /** Path prefixes exempt from CSRF checking (e.g. webhook endpoints). */
  exclude?: string[];
  /** Override attributes for the CSRF cookie. */
  cookie?: {
    httpOnly?: boolean;
    sameSite?: string;
    secure?: boolean;
    path?: string;
  };
}
