import { createHmac, timingSafeEqual } from "node:crypto";
import { ForbiddenException } from "../exceptions";
import {
  isProductionEnv,
  RouterResponseController,
} from "../core/router/router-response-controller";

export interface CsrfOptions {
  /**
   * Cookie name for the CSRF token.
   * Defaults to `"__Host-csrf"` when `NODE_ENV === "production"` (secure
   * `__Host-` prefix enforces Secure + no Domain), otherwise `"csrf"`.
   */
  cookieName?: string;
  /** Request header that carries the token. Default: `"x-csrf-token"` */
  headerName?: string;
  /**
   * Optional HMAC secret enabling the **signed** double-submit pattern. When
   * set, minted tokens carry a server-issued signature (`nonce.hmac`) that is
   * verified on every unsafe request. This defeats an attacker who can *write*
   * the victim's CSRF cookie (e.g. a compromised sibling subdomain, or a
   * dev-mode non-`Secure` cookie): they cannot forge a valid signature without
   * the secret. Omit to keep the plain (unsigned) double-submit behaviour.
   *
   * Use a high-entropy, deployment-stable secret shared across all instances.
   */
  secret?: string;
  /** HTTP methods that require a valid CSRF token. Default: POST, PUT, PATCH, DELETE. */
  methods?: string[];
  /**
   * Path prefixes to skip CSRF validation entirely. Useful for webhook
   * endpoints authenticated by a request signature rather than session.
   * Example: `["/webhooks", "/api/public"]`
   */
  exclude?: string[];
  /** Override default cookie attributes for the CSRF cookie. */
  cookie?: {
    httpOnly?: boolean;
    sameSite?: string;
    secure?: boolean;
    path?: string;
  };
}

interface CompiledCsrfOptions {
  readonly cookieName: string;
  readonly headerName: string;
  readonly secret?: string;
  readonly methods: ReadonlySet<string>;
  readonly exclude: readonly string[];
  readonly cookie: {
    readonly httpOnly: boolean;
    readonly sameSite: string;
    readonly secure: boolean;
    readonly path: string;
  };
}

/** Compile CSRF options once at boot; the result is a frozen config object. */
export function compileCsrfOptions(opts: CsrfOptions = {}): CompiledCsrfOptions {
  const isProduction = isProductionEnv();
  const defaultCookieName = isProduction ? "__Host-csrf" : "csrf";

  const cookieOverrides = opts.cookie ?? {};
  const compiled: CompiledCsrfOptions = Object.freeze({
    cookieName: opts.cookieName ?? defaultCookieName,
    headerName: opts.headerName ?? "x-csrf-token",
    secret: opts.secret,
    methods: Object.freeze(
      new Set((opts.methods ?? ["POST", "PUT", "PATCH", "DELETE"]).map((m) => m.toUpperCase())),
    ) as ReadonlySet<string>,
    exclude: Object.freeze(opts.exclude ?? []),
    cookie: Object.freeze({
      // Double-submit: cookie MUST be JS-readable so the browser can copy it
      // into the request header. httpOnly defaults to false.
      httpOnly: cookieOverrides.httpOnly ?? false,
      sameSite: cookieOverrides.sameSite ?? "lax",
      secure: cookieOverrides.secure ?? isProduction,
      path: cookieOverrides.path ?? "/",
    }),
  });

  return compiled;
}

/**
 * Extracts the pathname from a request URL without allocating a `URL`
 * object (the adapter's `getRequestPath` idiom — this runs per request
 * when `exclude` paths are configured).
 */
function getRequestPathname(url: string): string {
  const protocolIndex = url.indexOf("://");
  if (protocolIndex === -1) return url;
  const pathStart = url.indexOf("/", protocolIndex + 3);
  if (pathStart === -1) return "/";
  const queryStart = url.indexOf("?", pathStart);
  return queryStart === -1 ? url.slice(pathStart) : url.slice(pathStart, queryStart);
}

/**
 * Parses cookies from a raw `Cookie:` header string into a name→value map.
 */
function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (name) result[name] = safeDecodeURIComponent(value);
  }
  return result;
}

/**
 * `decodeURIComponent` that never throws. Malformed percent-encoding (e.g. a
 * lone `%`) yields a `URIError`; returning the raw value instead keeps a
 * hand-crafted cookie from surfacing as a per-request 500.
 */
function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Timing-safe string comparison. Returns `true` when both strings are equal.
 * Pads the shorter string to the length of the longer one using Buffers so
 * length mismatches do not short-circuit the comparison.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length === bufB.length) {
    return timingSafeEqual(bufA, bufB);
  }
  // Lengths differ: run a constant-time comparison against the longer buffer
  // for timing consistency, but the result is ALWAYS false. Returning the
  // padded `timingSafeEqual` here would be a bug — two strings differing only
  // by trailing NUL bytes ("abc" vs "abc\x00") zero-pad to identical buffers
  // and would compare equal.
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  timingSafeEqual(paddedA, paddedB);
  return false;
}

/** HMAC-SHA256 of `nonce` under `secret`, base64url-encoded. */
function signNonce(nonce: string, secret: string): string {
  return createHmac("sha256", secret).update(nonce).digest("base64url");
}

/**
 * Mint a CSRF token. Without a secret this is a 32-byte random hex string
 * (plain double-submit). With a secret the token is `${nonce}.${hmac}` so the
 * server can later verify it was the issuer (signed double-submit).
 */
function mintToken(secret?: string): string {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  return secret ? `${nonce}.${signNonce(nonce, secret)}` : nonce;
}

/**
 * Verifies a signed double-submit token of the form `${nonce}.${hmac}`. The
 * signature is recomputed over the nonce and compared in constant time. An
 * unsigned/malformed token returns false so a stripped signature cannot
 * downgrade the check to plain double-submit.
 */
function verifySignedToken(token: string, secret: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot >= token.length - 1) return false;
  const nonce = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  return timingSafeStringEqual(signature, signNonce(nonce, secret));
}

/**
 * Returns an Elysia `beforeHandle` middleware function that implements CSRF
 * double-submit cookie protection.
 *
 * - **Safe methods** (GET, HEAD, OPTIONS): mints a fresh token into the CSRF
 *   cookie if absent. The cookie is NOT httpOnly so browser JS can copy it
 *   into the `x-csrf-token` request header on subsequent mutating requests.
 * - **Unsafe methods** (POST, PUT, PATCH, DELETE): reads the token from the
 *   CSRF cookie and from the configured request header, then compares them
 *   with a timing-safe comparison. A mismatch returns 403 problem+json.
 * - Routes decorated with `@CsrfExempt()` are skipped entirely.
 * - Paths listed in `exclude` are skipped entirely.
 *
 * Runs as a global middleware AFTER guards, so authentication failures
 * (401) take precedence over CSRF mismatches (403).
 */
export function csrfProtection(opts: CsrfOptions = {}) {
  const config = compileCsrfOptions(opts);
  const responseController = new RouterResponseController();

  return function csrfBeforeHandle(ctx: any) {
    const request: Request = ctx.request;
    const method = request.method.toUpperCase();

    // --- Path exclusions ---
    if (config.exclude.length > 0) {
      const pathname = getRequestPathname(request.url);
      for (const prefix of config.exclude) {
        if (pathname === prefix || pathname.startsWith(prefix + "/")) {
          return;
        }
      }
    }

    // --- Cookie token resolution ---
    // Prefer Elysia's structured cookie jar; fall back to raw header parse.
    let cookieToken: string | undefined;
    const jar = (ctx as any).cookie;
    if (jar && typeof jar === "object") {
      const entry = jar[config.cookieName];
      if (entry && typeof entry === "object" && "value" in entry) {
        cookieToken = entry.value as string | undefined;
      } else if (typeof entry === "string") {
        cookieToken = entry;
      }
    } else {
      const raw = parseCookieHeader(request.headers.get("cookie"));
      cookieToken = raw[config.cookieName];
    }

    // --- Safe methods: mint token if absent ---
    if (!config.methods.has(method)) {
      if (!cookieToken) {
        const token = mintToken(config.secret);
        const cookieOpts = config.cookie;
        const cookieStr = [
          `${encodeURIComponent(config.cookieName)}=${encodeURIComponent(token)}`,
          cookieOpts.path ? `; Path=${cookieOpts.path}` : "",
          cookieOpts.sameSite ? `; SameSite=${cookieOpts.sameSite}` : "",
          cookieOpts.secure ? "; Secure" : "",
          cookieOpts.httpOnly ? "; HttpOnly" : "",
        ].join("");

        // Try to set via Elysia cookie jar first
        if (jar && typeof jar === "object" && jar[config.cookieName] !== undefined) {
          jar[config.cookieName].set({
            value: token,
            httpOnly: cookieOpts.httpOnly,
            sameSite: cookieOpts.sameSite,
            secure: cookieOpts.secure,
            path: cookieOpts.path,
          });
        } else {
          // Fall back to Set-Cookie response header
          const set = ctx.set;
          if (set) {
            const existing = set.headers;
            if (existing == null) {
              set.headers = { "set-cookie": cookieStr };
            } else if (existing instanceof Headers) {
              existing.append("set-cookie", cookieStr);
            } else {
              const rec = existing as Record<string, string | string[]>;
              const prev = rec["set-cookie"];
              if (!prev) {
                rec["set-cookie"] = cookieStr;
              } else if (Array.isArray(prev)) {
                prev.push(cookieStr);
              } else {
                rec["set-cookie"] = [prev, cookieStr];
              }
            }
          }
        }
      }
      return;
    }

    // --- Unsafe methods: validate token ---
    const headerToken = request.headers.get(config.headerName) ?? undefined;

    if (!cookieToken || !headerToken || !timingSafeStringEqual(cookieToken, headerToken)) {
      ctx.set.status = 403;
      return responseController.mapException(ctx, new ForbiddenException("CSRF token mismatch"));
    }

    // Signed double-submit: when a secret is configured the token must carry a
    // valid server-issued HMAC. This blocks an attacker who can WRITE the
    // victim's CSRF cookie from planting a self-chosen token in both the cookie
    // and the header — they cannot produce the signature without the secret.
    if (config.secret && !verifySignedToken(cookieToken, config.secret)) {
      ctx.set.status = 403;
      return responseController.mapException(ctx, new ForbiddenException("CSRF token invalid"));
    }
  };
}
