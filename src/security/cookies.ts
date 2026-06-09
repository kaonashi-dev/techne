import { isProductionEnv } from "../core/router/router-response-controller";

export interface CookieSetOptions {
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none" | string;
  secure?: boolean;
  path?: string;
  maxAge?: number;
  expires?: Date;
}

/**
 * Sets a cookie on Elysia's cookie jar with secure-by-default attributes.
 *
 * Defaults:
 * - `httpOnly: true`
 * - `sameSite: "lax"`
 * - `secure: true` in production (the framework-wide cached flag)
 * - `path: "/"`
 */
export function setCookie(jar: any, name: string, value: string, options?: CookieSetOptions): void {
  const isProduction = isProductionEnv();
  const httpOnly = options?.httpOnly !== undefined ? options.httpOnly : true;
  const sameSite = options?.sameSite !== undefined ? options.sameSite : "lax";
  const secure = options?.secure !== undefined ? options.secure : isProduction;
  const path = options?.path !== undefined ? options.path : "/";

  const cookieOptions: Record<string, unknown> = {
    value,
    httpOnly,
    sameSite,
    secure,
    path,
  };

  if (options?.maxAge !== undefined) cookieOptions.maxAge = options.maxAge;
  if (options?.expires !== undefined) cookieOptions.expires = options.expires;

  if (jar && typeof jar[name] === "object" && jar[name] !== null) {
    jar[name].set(cookieOptions);
  } else if (jar && typeof jar === "object") {
    // Fallback: directly assign on cookie jar entry
    jar[name] = cookieOptions;
  }
}
