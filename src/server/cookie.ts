import { HttpError } from "./status";

export interface CookieAttributes {
  domain?: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | (string & {}) | boolean;
  partitioned?: boolean;
  priority?: "low" | "medium" | "high";
}

export interface CookieConfig {
  /** Secret, or rotation list (first signs, all verify), for signed cookies. */
  secrets?: string | string[];
  /** Cookie names to sign, or `true` for all of them. */
  sign?: true | readonly string[];
}

/** One cookie in the request jar. Writing `value` or calling `set()` emits `Set-Cookie`. */
export interface Cookie extends CookieAttributes {
  value: string | undefined;
  set(options: CookieAttributes & { value?: string }): Cookie;
  remove(): void;
}

export type CookieJar = Record<string, Cookie>;

export class InvalidCookieSignature extends HttpError {
  readonly key: string;
  constructor(key: string) {
    super(401, "invalid-cookie-signature", `"${key}" has invalid cookie signature`);
    this.key = key;
  }
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    if (!key || out.has(key)) continue;
    let value = pair.slice(eq + 1).trim();
    if (value.length > 1 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    if (value.indexOf("%") !== -1) {
      try {
        value = decodeURIComponent(value);
      } catch {
        // keep the raw value
      }
    }
    out.set(key, value);
  }
  return out;
}

function signature(value: string, secret: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(value).digest("base64").replace(/=+$/, "");
}

export function signCookie(value: string, secret: string): string {
  return `${value}.${signature(value, secret)}`;
}

/** Returns the unsigned value, or `undefined` when no secret matches. */
export function unsignCookie(signed: string, secrets: readonly string[]): string | undefined {
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const value = signed.slice(0, dot);
  const mac = signed.slice(dot + 1);
  for (const secret of secrets) {
    const expected = signature(value, secret);
    if (expected.length === mac.length && timingSafeEqual(expected, mac)) return value;
  }
  return undefined;
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function serializeCookie(name: string, value: string, attrs: CookieAttributes): string {
  let out = `${name}=${encodeURIComponent(value)}`;
  if (attrs.maxAge !== undefined) out += `; Max-Age=${Math.floor(attrs.maxAge)}`;
  if (attrs.domain) out += `; Domain=${attrs.domain}`;
  if (attrs.path) out += `; Path=${attrs.path}`;
  if (attrs.expires) out += `; Expires=${attrs.expires.toUTCString()}`;
  if (attrs.httpOnly) out += "; HttpOnly";
  if (attrs.secure) out += "; Secure";
  if (attrs.partitioned) out += "; Partitioned";
  if (attrs.priority) out += `; Priority=${capitalize(attrs.priority)}`;
  const sameSite = attrs.sameSite === true ? "strict" : attrs.sameSite;
  if (sameSite) out += `; SameSite=${capitalize(sameSite)}`;
  return out;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

interface CookieState {
  value: string | undefined;
  attrs: CookieAttributes;
  dirty: boolean;
}

const ATTRIBUTE_KEYS = new Set([
  "domain",
  "path",
  "expires",
  "maxAge",
  "httpOnly",
  "secure",
  "sameSite",
  "partitioned",
  "priority",
]);

/**
 * Lazy cookie jar for one request: the `Cookie` header is parsed on first
 * access, and only cookies that were written produce `Set-Cookie` headers.
 */
export class RequestCookies {
  private parsed: Map<string, string> | undefined;
  private readonly states = new Map<string, CookieState>();
  private proxy: CookieJar | undefined;

  constructor(
    private readonly header: string | null,
    private readonly config: CookieConfig | undefined,
  ) {}

  private incoming(): Map<string, string> {
    return (this.parsed ??= parseCookieHeader(this.header));
  }

  private secrets(): string[] {
    const s = this.config?.secrets;
    return s === undefined ? [] : Array.isArray(s) ? s : [s as string];
  }

  private isSigned(name: string): boolean {
    const sign = this.config?.sign;
    if (!sign || this.secrets().length === 0) return false;
    return sign === true || sign.includes(name);
  }

  private state(name: string): CookieState {
    let state = this.states.get(name);
    if (state) return state;
    let value = this.incoming().get(name);
    if (value !== undefined && this.isSigned(name)) {
      const unsigned = unsignCookie(value, this.secrets());
      if (unsigned === undefined) throw new InvalidCookieSignature(name);
      value = unsigned;
    }
    state = { value, attrs: {}, dirty: false };
    this.states.set(name, state);
    return state;
  }

  private entry(name: string): Cookie {
    const self = this;
    const entry = {
      get value() {
        return self.state(name).value;
      },
      set value(value: string | undefined) {
        const state = self.state(name);
        state.value = value;
        state.dirty = true;
      },
      set(options: CookieAttributes & { value?: string }) {
        const state = self.state(name);
        for (const key in options) {
          if (key === "value") state.value = options.value;
          else if (ATTRIBUTE_KEYS.has(key)) (state.attrs as any)[key] = (options as any)[key];
        }
        state.dirty = true;
        return entry as Cookie;
      },
      remove() {
        const state = self.state(name);
        state.value = "";
        state.attrs = { ...state.attrs, expires: new Date(0), maxAge: 0 };
        state.dirty = true;
      },
    };
    for (const key of ATTRIBUTE_KEYS) {
      Object.defineProperty(entry, key, {
        enumerable: true,
        get: () => (self.state(name).attrs as any)[key],
        set: (v: unknown) => {
          const state = self.state(name);
          (state.attrs as any)[key] = v;
          state.dirty = true;
        },
      });
    }
    return entry as Cookie;
  }

  /** The jar exposed as `ctx.cookie`: any name yields an entry. */
  jar(): CookieJar {
    if (this.proxy) return this.proxy;
    const entries = new Map<string, Cookie>();
    this.proxy = new Proxy({} as CookieJar, {
      get: (_, name) => {
        if (typeof name !== "string") return undefined;
        let entry = entries.get(name);
        if (!entry) entries.set(name, (entry = this.entry(name)));
        return entry;
      },
      set: (_, name, value) => {
        if (typeof name !== "string") return false;
        const entry = this.proxy![name]!;
        if (value && typeof value === "object") entry.set(value as CookieAttributes);
        else entry.value = value == null ? undefined : String(value);
        return true;
      },
      has: (_, name) => typeof name === "string" && this.incoming().has(name),
      ownKeys: () => [...new Set([...this.incoming().keys(), ...this.states.keys()])],
      getOwnPropertyDescriptor: (_, name) =>
        typeof name === "string" && (this.incoming().has(name) || this.states.has(name))
          ? { enumerable: true, configurable: true, value: this.proxy![name] }
          : undefined,
    });
    return this.proxy;
  }

  /** `Set-Cookie` values for every written cookie. */
  setCookieHeaders(): string[] {
    const out: string[] = [];
    for (const [name, state] of this.states) {
      if (!state.dirty) continue;
      let value = state.value ?? "";
      if (value !== "" && this.isSigned(name)) value = signCookie(value, this.secrets()[0]!);
      out.push(serializeCookie(name, value, state.attrs));
    }
    return out;
  }
}
