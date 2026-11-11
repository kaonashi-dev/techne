import type { Static, TSchema } from "../schema/core/types";
import type { CookieConfig, CookieJar } from "./cookie";
import type { StatusResult, status } from "./status";

export type MaybePromise<T> = T | Promise<T>;
export type MaybeArray<T> = T | T[];
export type Server = ReturnType<typeof Bun.serve>;
export type HookScope = "local" | "scoped" | "global";

export interface AppOptions<Prefix extends string = "", Scope extends HookScope = "local"> {
  /** Path prefix for every route of this app and the apps it mounts. */
  prefix?: Prefix;
  /** Plugin name: apps with the same name (and `seed`) are mounted once. */
  name?: string;
  seed?: unknown;
  /** Default scope of this app's hooks and derived context. */
  as?: Scope;
  /** Treat `/a` and `/a/` as different paths. Off by default. */
  strictPath?: boolean;
  /** Signed cookie configuration for `ctx.cookie`. */
  cookie?: CookieConfig;
}

export type ListenOptions = Omit<Parameters<typeof Bun.serve>[0], "fetch" | "routes"> & {
  port?: number | string;
  hostname?: string;
};

export interface RouteSchema {
  body?: TSchema;
  query?: TSchema;
  params?: TSchema;
  headers?: TSchema;
  /** Response schema, or one per status code. Used for typing. */
  response?: TSchema | { [status: number]: TSchema };
}

type Hook<C> = (ctx: C) => unknown;

/** Route schemas plus route-local hooks. */
export type RouteOptions<S extends RouteSchema, C> = S & {
  transform?: MaybeArray<Hook<C>>;
  beforeHandle?: MaybeArray<Hook<C>>;
  afterHandle?: MaybeArray<Hook<C & { response: unknown }>>;
  mapResponse?: MaybeArray<Hook<C & { response: unknown }>>;
  error?: MaybeArray<Hook<C & { error: unknown }>>;
  afterResponse?: MaybeArray<Hook<C & { response: unknown }>>;
};

/** Path parameters declared in a route template. */
export type ParamsOf<Path extends string> = string extends Path
  ? Record<string, string>
  : Path extends `${string}:${infer Name}/${infer Rest}`
    ? { [K in Name]: string } & ParamsOf<`/${Rest}`>
    : Path extends `${string}:${infer Name}?`
      ? { [K in Name]?: string }
      : Path extends `${string}:${infer Name}`
        ? { [K in Name]: string }
        : Path extends `${string}*`
          ? { "*": string }
          : {};

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type Part<S, K extends keyof RouteSchema, Fallback> = S extends {
  [P in K]: infer T extends TSchema;
}
  ? Static<T>
  : Fallback;

export type QueryRecord = Record<string, string | string[] | undefined>;
export type HeaderRecord = Record<string, string | undefined>;
export type ParamRecord = Record<string, string>;

export interface SetContext {
  status: number | keyof import("./status").StatusMap;
  headers: Record<string, string | number>;
}

/** The context every route handler and hook receives. */
export type Context<
  S extends RouteSchema = {},
  Extra extends object = {},
  Path extends string = string,
> = {
  request: Request;
  /** Request path, without the query string. */
  path: string;
  /** Matched route template, e.g. `/users/:id`. */
  route: string;
  params: Part<S, "params", Prettify<ParamsOf<Path>>>;
  query: Part<S, "query", QueryRecord>;
  headers: Part<S, "headers", HeaderRecord>;
  body: Part<S, "body", unknown>;
  cookie: CookieJar;
  set: SetContext;
  store: Record<string, any>;
  server: Server | null;
  status: typeof status;
  redirect(url: string, code?: 301 | 302 | 303 | 307 | 308): StatusResult;
} & Extra;

/** Context of `request` hooks, which run before routing. */
export type PreContext<Extra extends object = {}> = 0 extends 1 & Extra
  ? any
  : Omit<Context<{}, Extra>, "params" | "body" | "route">;

export type AfterContext<Extra extends object = {}> = Context<{}, Extra> & {
  response: unknown;
  responseValue: unknown;
};

export type ErrorContext<Extra extends object = {}, E = unknown> = Context<{}, Extra> & {
  error: E;
};

export type JoinPath<Prefix extends string, Path extends string> = Prefix extends ""
  ? Path
  : Path extends "" | "/"
    ? Prefix
    : `${Prefix}${Path}`;

type UnionKeys<U> = U extends unknown ? keyof U : never;
type MergeUnion<U> = { [K in UnionKeys<U>]: U extends { [P in K]: infer V } ? V : never };

type ResponseEntry<A> =
  A extends StatusResult<infer C, infer B>
    ? { [K in C]: B }
    : A extends Response
      ? { 200: unknown }
      : A extends (...args: any[]) => infer F
        ? ResponseEntry<Awaited<F>>
        : { 200: A };

/** Response bodies by status code, inferred from what a handler returns. */
export type ResponseOf<R> = MergeUnion<ResponseEntry<Awaited<R>>>;

export type RouteInfo<S extends RouteSchema, R, Path extends string> = {
  body: Part<S, "body", unknown>;
  params: Part<S, "params", Prettify<ParamsOf<Path>>>;
  query: Part<S, "query", unknown>;
  headers: Part<S, "headers", unknown>;
  response: ResponseOf<R>;
};

export type RouteEntry<Method extends string, Path extends string, S extends RouteSchema, R> = {
  [P in Path]: { [M in Method]: RouteInfo<S, R, Path> };
};

/** Any Techne app, whatever its type parameters. */
export interface AnyApp {
  readonly "~routes": object;
  readonly "~exported": object;
}

export type RoutesOf<A> = A extends { readonly "~routes": infer R } ? R : {};
export type ExportedOf<A> = A extends { readonly "~exported": infer E extends object } ? E : {};

export type PrefixRoutes<Prefix extends string, R> = Prefix extends ""
  ? R
  : { [K in keyof R as K extends string ? JoinPath<Prefix, K> : never]: R[K] };
