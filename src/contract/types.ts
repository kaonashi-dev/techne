// ─── Public types for the @bnest/contract RPC client ────────────────────────
//
// Stage-2 decorators don't yet flow controller signatures into a `Routes` type
// at compile time, so we model the client around an explicit `RouteMap` shape
// that either (a) the user hand-writes, or (b) `bnest generate client`
// produces from TypeBox schemas.
//
// The runtime client (`createClient`) is fully untyped under the hood — the
// `RouteMap` only exists at the type layer to constrain proxy access.

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/**
 * Describes the shape of one HTTP route at the type level. All four slots are
 * optional so a `get /healthz` with no params/body/query/response just becomes
 * `RouteHandler<undefined, undefined, undefined, unknown>`.
 */
export type RouteHandler<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown,
  TResponse = unknown,
> = {
  body?: TBody;
  query?: TQuery;
  params?: TParams;
  response?: TResponse;
};

/**
 * The route-map contract. Keys are full route paths (e.g. `/users/:id`),
 * values are partial `{ get, post, put, patch, delete }` records.
 */
export type RouteMap = {
  [path: string]: Partial<Record<HttpMethod, RouteHandler>>;
};

// ─── Client surface ──────────────────────────────────────────────────────────

export interface ClientOptions {
  baseUrl: string;
  /** Default headers merged into every request (per-call `headers` win on key collision). */
  headers?: HeadersInit;
  /** Inject a fetch implementation — defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Invoked with the parsed {@link ClientError} before it is thrown. */
  onError?: (err: ClientError) => void;
}

export interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  instance?: string;
  requestId?: string;
  [key: string]: unknown;
}

/** Thrown on non-2xx responses. `problem` is populated when the server returns RFC 7807. */
export class ClientError extends Error {
  status: number;
  problem?: ProblemDocument;

  constructor(message: string, status: number, problem?: ProblemDocument) {
    super(message);
    this.name = "ClientError";
    this.status = status;
    this.problem = problem;
  }
}

/**
 * Per-call arguments derived from a `RouteHandler`. Slots typed `undefined`
 * become optional and `unknown` when present so users aren't forced to pass
 * empty objects.
 */
export type ClientRequest<H extends RouteHandler> = {
  body?: H["body"];
  query?: H["query"];
  params?: H["params"];
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type ClientResponse<H extends RouteHandler> =
  H extends RouteHandler<any, any, any, infer Res> ? Res : unknown;

/**
 * The proxy type produced by `createClient<R>()`. Indexing by a known route
 * path returns an object of per-method call functions, each typed from the
 * matching `RouteHandler` slot.
 */
export type TypedClient<R extends RouteMap> = {
  [P in keyof R]: {
    [M in keyof R[P]]: M extends HttpMethod
      ? R[P][M] extends RouteHandler<infer B, infer Q, infer Pa, infer Res>
        ? (args?: {
            body?: B;
            query?: Q;
            params?: Pa;
            headers?: HeadersInit;
            signal?: AbortSignal;
          }) => Promise<Res>
        : (args?: { headers?: HeadersInit; signal?: AbortSignal }) => Promise<unknown>
      : never;
  };
};
