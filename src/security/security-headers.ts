/**
 * Helmet-style security response headers.
 *
 * Options are compiled once at boot into a frozen, lowercase-keyed header
 * record via {@link compileSecurityHeaders}; the adapter stamps that record
 * onto every response from its fused `onAfterHandle`/`onError` hooks, so the
 * per-request cost is a single merge and the option objects never survive
 * past boot.
 */

export interface HstsOptions {
  /** `max-age` in seconds. Default: 15552000 (180 days). */
  maxAge?: number;
  /** Append `includeSubDomains`. Default: true. */
  includeSubDomains?: boolean;
  /** Append `preload`. Default: false. */
  preload?: boolean;
}

/**
 * CSP as a directive map, e.g. `{ "default-src": "'self'", "img-src":
 * ["'self'", "data:"] }`. Serialized to the standard `; `-joined policy
 * string at compile time.
 */
export type CspDirectives = Record<string, string | string[]>;

/**
 * Per-header configuration for the security-headers preset. Every header in
 * the preset is emitted by default and can be disabled with `false`;
 * `contentSecurityPolicy` is the one opt-in (there is no universally safe
 * default policy for an API framework).
 */
export interface SecurityHeadersOptions {
  /** `X-Content-Type-Options: nosniff`. `false` disables. */
  contentTypeOptions?: false;
  /** `X-Frame-Options`. Default: `"SAMEORIGIN"`. */
  frameOptions?: "DENY" | "SAMEORIGIN" | false;
  /**
   * `Strict-Transport-Security`. Default: 180 days + includeSubDomains.
   * Always emitted — browsers ignore HSTS received over plain HTTP, so
   * local development is unaffected.
   */
  hsts?: false | HstsOptions;
  /** `Referrer-Policy`. Default: `"no-referrer"`. */
  referrerPolicy?: string | false;
  /** `Cross-Origin-Opener-Policy`. Default: `"same-origin"`. */
  crossOriginOpenerPolicy?: string | false;
  /** `Cross-Origin-Resource-Policy`. Default: `"same-origin"`. */
  crossOriginResourcePolicy?: string | false;
  /** `X-Permitted-Cross-Domain-Policies: none`. `false` disables. */
  permittedCrossDomainPolicies?: false;
  /** `Content-Security-Policy`. Opt-in: a policy string or directive map. */
  contentSecurityPolicy?: string | CspDirectives | false;
  /**
   * Extra headers merged last, so entries here override any preset header
   * with the same (case-insensitive) name.
   */
  custom?: Record<string, string>;
}

function serializeCsp(policy: string | CspDirectives): string {
  if (typeof policy === "string") return policy;
  const parts: string[] = [];
  for (const [directive, value] of Object.entries(policy)) {
    const sources = Array.isArray(value) ? value.join(" ") : value;
    parts.push(sources.length > 0 ? `${directive} ${sources}` : directive);
  }
  return parts.join("; ");
}

/**
 * Compiles security-header options into a frozen lowercase-keyed record.
 * Pass `true` for the full preset with defaults.
 */
export function compileSecurityHeaders(
  options: SecurityHeadersOptions | true,
): Readonly<Record<string, string>> {
  const opts: SecurityHeadersOptions = options === true ? {} : options;
  const headers: Record<string, string> = {};

  if (opts.contentTypeOptions !== false) {
    headers["x-content-type-options"] = "nosniff";
  }
  if (opts.frameOptions !== false) {
    headers["x-frame-options"] = opts.frameOptions ?? "SAMEORIGIN";
  }
  if (opts.hsts !== false) {
    const hsts = opts.hsts ?? {};
    let value = `max-age=${hsts.maxAge ?? 15_552_000}`;
    if (hsts.includeSubDomains !== false) value += "; includeSubDomains";
    if (hsts.preload) value += "; preload";
    headers["strict-transport-security"] = value;
  }
  if (opts.referrerPolicy !== false) {
    headers["referrer-policy"] = opts.referrerPolicy ?? "no-referrer";
  }
  if (opts.crossOriginOpenerPolicy !== false) {
    headers["cross-origin-opener-policy"] = opts.crossOriginOpenerPolicy ?? "same-origin";
  }
  if (opts.crossOriginResourcePolicy !== false) {
    headers["cross-origin-resource-policy"] = opts.crossOriginResourcePolicy ?? "same-origin";
  }
  if (opts.permittedCrossDomainPolicies !== false) {
    headers["x-permitted-cross-domain-policies"] = "none";
  }
  if (opts.contentSecurityPolicy !== undefined && opts.contentSecurityPolicy !== false) {
    headers["content-security-policy"] = serializeCsp(opts.contentSecurityPolicy);
  }
  if (opts.custom) {
    for (const [name, value] of Object.entries(opts.custom)) {
      headers[name.toLowerCase()] = value;
    }
  }

  return Object.freeze(headers);
}
