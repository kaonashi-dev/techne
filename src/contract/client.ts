import {
  ClientError,
  type ClientOptions,
  type HttpMethod,
  type ProblemDocument,
  type RouteMap,
  type TypedClient,
} from "./types";

const HTTP_METHODS = new Set<HttpMethod>(["get", "post", "put", "patch", "delete"]);
const BODY_METHODS = new Set<HttpMethod>(["post", "put", "patch", "delete"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Replace `:segment` placeholders in `path` with the matching `params` value. */
function substituteParams(path: string, params: Record<string, unknown> | undefined): string {
  if (!params) return path;
  return path.replace(/:([A-Za-z0-9_]+)/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return match;
    return encodeURIComponent(String(value));
  });
}

/**
 * Build a query string from a top-level record. Arrays expand into repeated
 * `?key=a&key=b` pairs (RFC 6570 style — what most REST APIs accept).
 * `undefined`/`null` values are skipped silently.
 */
function buildQueryString(query: unknown): string {
  if (!query || !isPlainObject(query)) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Trim a single trailing slash from `baseUrl`. Leaves a bare protocol root alone. */
function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.length > 1 && baseUrl.endsWith("/")) return baseUrl.slice(0, -1);
  return baseUrl;
}

function mergeHeaders(...inits: (HeadersInit | undefined)[]): Headers {
  const merged = new Headers();
  for (const init of inits) {
    if (!init) continue;
    const next = new Headers(init);
    next.forEach((value, key) => {
      merged.set(key, value);
    });
  }
  return merged;
}

async function parseProblem(response: Response): Promise<ProblemDocument | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  // The framework defaults to application/problem+json (RFC 7807) but some
  // proxies/middleware downgrade it to plain JSON, so fall back to that too.
  const isProblem =
    contentType.includes("application/problem+json") || contentType.includes("application/json");
  if (!isProblem) return undefined;
  try {
    const body = (await response.json()) as ProblemDocument;
    if (body && typeof body === "object" && typeof body.title === "string") return body;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a typed RPC client. `R` is a {@link RouteMap}, typically produced by
 * `techne generate client` from the running app or hand-written by the user.
 *
 * ```ts
 * const api = createClient<Routes>("http://localhost:3000");
 * const user = await api["/users/:id"].get({ params: { id: "42" } });
 * ```
 */
export function createClient<R extends RouteMap>(
  optsOrUrl: string | ClientOptions,
): TypedClient<R> {
  const opts: ClientOptions =
    typeof optsOrUrl === "string" ? { baseUrl: optsOrUrl } : { ...optsOrUrl };
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const defaultHeaders = opts.headers;
  const onError = opts.onError;

  // One proxy per path key — cached so identity stays stable across reads.
  const pathProxyCache = new Map<string, unknown>();

  const makePathProxy = (path: string) => {
    const cached = pathProxyCache.get(path);
    if (cached) return cached;

    const methodCache = new Map<HttpMethod, Function>();
    const handler = new Proxy(Object.create(null) as Record<string, unknown>, {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        const method = prop.toLowerCase() as HttpMethod;
        if (!HTTP_METHODS.has(method)) return undefined;
        const existing = methodCache.get(method);
        if (existing) return existing;
        const fn = async (args: any = {}) => {
          const finalPath = substituteParams(path, args.params);
          const qs = buildQueryString(args.query);
          const url = `${baseUrl}${finalPath}${qs}`;

          const init: RequestInit = { method: method.toUpperCase() };
          const headers = mergeHeaders(defaultHeaders, args.headers);

          if (BODY_METHODS.has(method) && args.body !== undefined) {
            if (!headers.has("content-type")) {
              headers.set("content-type", "application/json");
            }
            init.body =
              typeof args.body === "string" || args.body instanceof FormData
                ? (args.body as any)
                : JSON.stringify(args.body);
          }

          init.headers = headers;
          if (args.signal) init.signal = args.signal;

          const response = await fetchImpl(url, init);
          if (!response.ok) {
            const problem = await parseProblem(response);
            const message =
              problem?.title ?? `Request failed: ${response.status} ${response.statusText}`;
            const err = new ClientError(message, response.status, problem);
            if (onError) onError(err);
            throw err;
          }

          if (response.status === 204) return undefined as unknown;
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            return (await response.json()) as unknown;
          }
          // Fall back to text — callers can still treat the promise result as
          // `unknown` and inspect it.
          const text = await response.text();
          return text.length === 0 ? undefined : (text as unknown);
        };
        methodCache.set(method, fn);
        return fn;
      },
    });

    pathProxyCache.set(path, handler);
    return handler;
  };

  const root = new Proxy(Object.create(null), {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      return makePathProxy(prop);
    },
  });

  return root as TypedClient<R>;
}
