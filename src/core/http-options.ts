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

export interface RouteRegistrationOptions {
  globalPrefix?: {
    prefix: string;
    exclude?: string[];
  };
  versioning?: VersioningOptions;
}
