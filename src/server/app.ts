import { Compile } from "../schema/core/compile";
import type { TSchema } from "../schema/core/types";
import { RequestCookies, type CookieConfig, type CookieJar } from "./cookie";
import { Router, parseQuery } from "./router";
import {
  internalServerErrorResponse,
  NotFoundError,
  ParseError,
  status,
  StatusResult,
  toStatusCode,
  ValidationError,
  type ValidationIssue,
  type ValidationTarget,
} from "./status";
import type {
  AfterContext,
  AnyApp,
  AppOptions,
  Context,
  ErrorContext,
  ExportedOf,
  HookScope,
  JoinPath,
  ListenOptions,
  ParamRecord,
  MaybePromise,
  PreContext,
  PrefixRoutes,
  RouteEntry,
  RouteOptions,
  RoutesOf,
  RouteSchema,
  Server,
  SetContext,
} from "./types";

/** The public shape every route handler and hook receives at runtime. */
export interface RuntimeContext {
  request: Request;
  path: string;
  route: string;
  params: ParamRecord;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  cookie: CookieJar;
  set: SetContext;
  store: Record<string, unknown>;
  server: Server | null;
  status: typeof status;
  response: unknown;
  error: unknown;
  responseValue: unknown;
  redirect(url: string, code?: 301 | 302 | 303 | 307 | 308): StatusResult;
}

type Fn = (ctx: RuntimeContext) => unknown;
type HookKind =
  | "request"
  | "transform"
  | "beforeHandle"
  | "afterHandle"
  | "mapResponse"
  | "error"
  | "afterResponse";

interface Hook {
  kind: HookKind;
  fn: Fn;
  scope: HookScope;
  /** For `error(Class, fn)`: only errors that are instances of this class. */
  match?: abstract new (...args: any[]) => unknown;
}

/** An ordered entry of an app: its own hook, or a mounted child app. */
type Entry = { hook: Hook } | { child: App<any, any, any, any, any> };

interface RouteDef {
  method: string;
  path: string;
  options: RouteOptions<any, any> | undefined;
  handler: unknown;
}

type HookLists = Record<HookKind, Hook[]>;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

/** Bumped on every mutation of any app, so roots know to recompile. */
let generation = 0;

/**
 * Techne's HTTP application: routes, schema validation, lifecycle hooks and
 * composition through `.use()`. Create one with `createApp()`.
 *
 * Hooks apply to the routes of the app they are registered on and of every
 * app it mounts, regardless of registration order. `as: "scoped"` also lifts
 * them into the parent; `as: "global"` lifts them to the root.
 */
export class App<
  const Prefix extends string = "",
  const Scope extends HookScope = "local",
  Ctx extends object = {},
  Exported extends object = {},
  Routes extends object = {},
> {
  /** Type-only route map, keyed by full path then method. */
  declare readonly "~routes": Routes;
  /** Type-only context visible to this app's handlers. */
  declare readonly "~ctx": Ctx;
  /** Type-only context a parent gains when it mounts this app. */
  declare readonly "~exported": Exported;
  declare readonly "~scope": Scope;

  readonly config: Readonly<AppOptions<Prefix, Scope>>;
  /** The Bun server once {@link listen} has been called. */
  server: Server | null = null;

  private readonly entries: Entry[] = [];
  private readonly routes: RouteDef[] = [];
  private readonly decorators: Record<string, unknown> = {};
  private readonly cleanups: (() => unknown)[] = [];
  private readonly store: Record<string, unknown> = {};
  private compiled: Compiled | undefined;
  private compiledAt = -1;

  constructor(options: AppOptions<Prefix, Scope> = {}) {
    this.config = options;
  }

  // ─── Routes ────────────────────────────────────────────────────────────────

  get<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"get", JoinPath<Prefix, P>, {}, R>>;
  get<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"get", JoinPath<Prefix, P>, S, R>>;
  get(path: string, a: unknown, b?: unknown): any {
    return this.add("GET", path, a, b, arguments.length);
  }

  post<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"post", JoinPath<Prefix, P>, {}, R>>;
  post<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"post", JoinPath<Prefix, P>, S, R>>;
  post(path: string, a: unknown, b?: unknown): any {
    return this.add("POST", path, a, b, arguments.length);
  }

  put<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"put", JoinPath<Prefix, P>, {}, R>>;
  put<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"put", JoinPath<Prefix, P>, S, R>>;
  put(path: string, a: unknown, b?: unknown): any {
    return this.add("PUT", path, a, b, arguments.length);
  }

  patch<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"patch", JoinPath<Prefix, P>, {}, R>>;
  patch<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"patch", JoinPath<Prefix, P>, S, R>>;
  patch(path: string, a: unknown, b?: unknown): any {
    return this.add("PATCH", path, a, b, arguments.length);
  }

  delete<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"delete", JoinPath<Prefix, P>, {}, R>>;
  delete<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"delete", JoinPath<Prefix, P>, S, R>>;
  delete(path: string, a: unknown, b?: unknown): any {
    return this.add("DELETE", path, a, b, arguments.length);
  }

  options<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"options", JoinPath<Prefix, P>, {}, R>>;
  options<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"options", JoinPath<Prefix, P>, S, R>>;
  options(path: string, a: unknown, b?: unknown): any {
    return this.add("OPTIONS", path, a, b, arguments.length);
  }

  head<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"head", JoinPath<Prefix, P>, {}, R>>;
  head<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"head", JoinPath<Prefix, P>, S, R>>;
  head(path: string, a: unknown, b?: unknown): any {
    return this.add("HEAD", path, a, b, arguments.length);
  }

  /** Matches every method that has no dedicated route on the same path. */
  all<const P extends string, R>(
    path: P,
    handler: R | ((ctx: Context<{}, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"all", JoinPath<Prefix, P>, {}, R>>;
  all<const P extends string, const S extends RouteSchema, R>(
    path: P,
    options: RouteOptions<S, Context<S, Ctx, JoinPath<Prefix, P>>>,
    handler: R | ((ctx: Context<S, Ctx, JoinPath<Prefix, P>>) => R),
  ): App<Prefix, Scope, Ctx, Exported, Routes & RouteEntry<"all", JoinPath<Prefix, P>, S, R>>;
  all(path: string, a: unknown, b?: unknown): any {
    return this.add("ALL", path, a, b, arguments.length);
  }

  /** Registers a route for an arbitrary method. */
  route(
    method: string,
    path: string,
    options: RouteOptions<any, any> | undefined,
    handler: unknown,
  ): this {
    return this.add(method.toUpperCase(), path, options ?? {}, handler, 3);
  }

  private add(method: string, path: string, a: unknown, b: unknown, arity: number): any {
    const [options, handler] = arity >= 3 ? [a as RouteOptions<any, any>, b] : [undefined, a];
    this.routes.push({ method, path, options, handler });
    generation++;
    return this;
  }

  // ─── Composition ───────────────────────────────────────────────────────────

  /**
   * Mounts another app: its routes (under this app's prefix), its hooks and
   * its decorations. Apps with the same `name` (and `seed`) mount once.
   */
  use<const C extends AnyApp>(
    plugin: C | ((app: this) => C),
  ): App<
    Prefix,
    Scope,
    Ctx & ExportedOf<C>,
    Exported & ExportedOf<C>,
    Routes & PrefixRoutes<Prefix, RoutesOf<C>>
  > {
    const child = typeof plugin === "function" ? (plugin as (app: this) => C)(this) : plugin;
    if ((child as unknown) !== this) {
      this.entries.push({ child: child as unknown as App });
      generation++;
    }
    return this as any;
  }

  /** Adds a value to every handler's context. Decorations propagate to parents. */
  decorate<const N extends string, V>(
    name: N,
    value: V,
  ): App<Prefix, Scope, Ctx & { [K in N]: V }, Exported & { [K in N]: V }, Routes>;
  decorate<const D extends Record<string, unknown>>(
    values: D,
  ): App<Prefix, Scope, Ctx & D, Exported & D, Routes>;
  decorate(name: string | Record<string, unknown>, value?: unknown): any {
    const values = typeof name === "string" ? { [name]: value } : name;
    for (const key in values) {
      if (!(key in this.decorators)) this.decorators[key] = values[key];
    }
    generation++;
    return this;
  }

  // ─── Lifecycle hooks ───────────────────────────────────────────────────────

  /** Runs before routing. Returning a value responds immediately. */
  request(fn: (ctx: PreContext<Ctx>) => unknown): this;
  request(options: { as?: HookScope }, fn: (ctx: PreContext<Ctx>) => unknown): this;
  request(a: unknown, b?: unknown): this {
    return this.hook("request", a, b);
  }

  /** Merges the returned object into the context, after routing and before validation. */
  derive<const D extends object | void>(
    fn: (ctx: Context<{}, Ctx>) => MaybePromise<D>,
  ): App<
    Prefix,
    Scope,
    Ctx & NonVoid<D>,
    Scope extends "local" ? Exported : Exported & NonVoid<D>,
    Routes
  >;
  derive<const D extends object | void, const As extends HookScope>(
    options: { as: As },
    fn: (ctx: Context<{}, Ctx>) => MaybePromise<D>,
  ): App<
    Prefix,
    Scope,
    Ctx & NonVoid<D>,
    As extends "local" ? Exported : Exported & NonVoid<D>,
    Routes
  >;
  derive(a: unknown, b?: unknown): any {
    return this.hook("transform", a, b);
  }

  /** Runs after validation. Returning a value skips the handler and responds with it. */
  beforeHandle(fn: (ctx: Context<{}, Ctx>) => unknown): this;
  beforeHandle(options: { as?: HookScope }, fn: (ctx: Context<{}, Ctx>) => unknown): this;
  beforeHandle(a: unknown, b?: unknown): this {
    return this.hook("beforeHandle", a, b);
  }

  /** Runs after the handler with `ctx.response`. Returning a value replaces the response. */
  afterHandle(fn: (ctx: AfterContext<Ctx>) => unknown): this;
  afterHandle(options: { as?: HookScope }, fn: (ctx: AfterContext<Ctx>) => unknown): this;
  afterHandle(a: unknown, b?: unknown): this {
    return this.hook("afterHandle", a, b);
  }

  /** Last chance to turn the response value into a custom `Response`. */
  mapResponse(fn: (ctx: AfterContext<Ctx>) => unknown): this;
  mapResponse(options: { as?: HookScope }, fn: (ctx: AfterContext<Ctx>) => unknown): this;
  mapResponse(a: unknown, b?: unknown): this {
    return this.hook("mapResponse", a, b);
  }

  /**
   * Handles errors thrown while serving a request, including 404s. Returning
   * a value responds with it; otherwise the next handler or the default runs.
   */
  error<E extends abstract new (...args: any[]) => unknown>(
    match: E,
    fn: (ctx: ErrorContext<Ctx, InstanceType<E>>) => unknown,
  ): this;
  error(fn: (ctx: ErrorContext<Ctx>) => unknown): this;
  error(options: { as?: HookScope }, fn: (ctx: ErrorContext<Ctx>) => unknown): this;
  error(a: unknown, b?: unknown): this {
    if (typeof a === "function" && typeof b === "function") {
      this.entries.push({
        hook: { kind: "error", fn: b as Fn, scope: this.defaultScope(), match: a as any },
      });
      generation++;
      return this;
    }
    return this.hook("error", a, b);
  }

  /** Runs after the response is produced. Never changes it. */
  afterResponse(fn: (ctx: AfterContext<Ctx>) => unknown): this;
  afterResponse(options: { as?: HookScope }, fn: (ctx: AfterContext<Ctx>) => unknown): this;
  afterResponse(a: unknown, b?: unknown): this {
    return this.hook("afterResponse", a, b);
  }

  /** Runs when the app stops, in reverse registration order. */
  cleanup(fn: () => unknown): this {
    this.cleanups.push(fn);
    return this;
  }

  private defaultScope(): HookScope {
    return this.config.as ?? "local";
  }

  private hook(kind: HookKind, a: unknown, b: unknown): this {
    const [scope, fn] =
      typeof a === "function"
        ? [this.defaultScope(), a as Fn]
        : [(a as { as?: HookScope } | undefined)?.as ?? this.defaultScope(), b as Fn];
    if (typeof fn !== "function") throw new TypeError(`${kind}() expects a function`);
    this.entries.push({ hook: { kind, fn, scope } });
    generation++;
    return this;
  }

  // ─── Serving ───────────────────────────────────────────────────────────────

  /** Serves one request in-process. */
  handle = (request: Request): Promise<Response> => {
    const result = this.serve(request, null);
    return result instanceof Response ? Promise.resolve(result) : result;
  };

  /** `fetch` handler, usable with `Bun.serve({ fetch: app.fetch })`. */
  fetch = (request: Request, server?: Server | null): Response | Promise<Response> =>
    this.serve(request, server ?? null);

  /** Starts a Bun server. Extra options pass through to `Bun.serve`. */
  listen(options: number | string | ListenOptions, callback?: (server: Server) => unknown): this {
    const config: ListenOptions =
      typeof options === "object" ? options : { port: Number(options) || 0 };
    this.compile();
    this.server = Bun.serve({
      ...config,
      fetch: (request: Request, server: Server) => this.serve(request, server),
    } as any) as Server;
    callback?.(this.server);
    return this;
  }

  /** Stops the server (if listening) and runs cleanups. */
  async stop(closeActiveConnections = false): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await server.stop(closeActiveConnections);
    for (const app of collectApps(this).reverse()) {
      for (let i = app.cleanups.length - 1; i >= 0; i--) await app.cleanups[i]!();
    }
  }

  private serve(request: Request, server: Server | null): Response | Promise<Response> {
    return this.compile().serve(request, server);
  }

  private compile(): Compiled {
    if (this.compiled && this.compiledAt === generation) return this.compiled;
    this.compiled = compileApp(this);
    this.compiledAt = generation;
    return this.compiled;
  }

  /** @internal */
  static internals(app: App<any, any, any, any, any>) {
    return app as unknown as {
      entries: Entry[];
      routes: RouteDef[];
      decorators: Record<string, unknown>;
      store: Record<string, unknown>;
      cleanups: (() => unknown)[];
    };
  }
}

type NonVoid<D> = D extends void | undefined ? {} : D;

// ─── Compilation ─────────────────────────────────────────────────────────────

function collectApps(root: App<any, any, any, any, any>): App<any, any, any, any, any>[] {
  const seen = new Set<string>();
  const out: App<any, any, any, any, any>[] = [];
  const visit = (app: App<any, any, any, any, any>) => {
    if (out.includes(app)) return;
    const key = dedupKey(app);
    if (key !== undefined) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    out.push(app);
    for (const entry of App.internals(app).entries) if ("child" in entry) visit(entry.child);
  };
  visit(root);
  return out;
}

function dedupKey(app: App<any, any, any, any, any>): string | undefined {
  const { name, seed } = app.config;
  if (!name) return undefined;
  return seed === undefined
    ? name
    : `${name}:${typeof seed === "object" ? JSON.stringify(seed) : String(seed)}`;
}

interface LiftedHook {
  hook: Hook;
  /** The direct child this hook was lifted from, or `null` for an own hook. */
  from: App<any, any, any, any, any> | null;
}

/** Own hooks plus hooks lifted from mounted children, in entry order. */
function effectiveHooks(
  app: App<any, any, any, any, any>,
  mounted: Set<App<any, any, any, any, any>>,
  cache: Map<App<any, any, any, any, any>, LiftedHook[]>,
): LiftedHook[] {
  const cached = cache.get(app);
  if (cached) return cached;
  const out: LiftedHook[] = [];
  for (const entry of App.internals(app).entries) {
    if ("hook" in entry) {
      out.push({ hook: entry.hook, from: null });
      continue;
    }
    if (!mounted.has(entry.child)) continue;
    for (const lifted of effectiveHooks(entry.child, mounted, cache)) {
      const scope = lifted.hook.scope;
      if (scope === "local") continue;
      // `scoped` lifts one level and stops; `global` keeps lifting.
      if (scope === "scoped" && lifted.from !== null) continue;
      out.push({ hook: lifted.hook, from: entry.child });
    }
  }
  cache.set(app, out);
  return out;
}

const emptyLists = (): HookLists => ({
  request: [],
  transform: [],
  beforeHandle: [],
  afterHandle: [],
  mapResponse: [],
  error: [],
  afterResponse: [],
});

function compileApp(root: App<any, any, any, any, any>): Compiled {
  const apps = collectApps(root);
  const included = new Set(apps);
  const cache = new Map<App<any, any, any, any, any>, LiftedHook[]>();
  const router = new Router<CompiledRoute>(root.config.strictPath === true);

  // Decorations are visible everywhere; the first registration wins. They
  // live on a per-root context prototype, so requests copy nothing.
  const ContextClass = class extends RequestContext {};
  const decorated = new Set<string>();
  for (const app of apps) {
    const own = App.internals(app).decorators;
    for (const key in own) {
      if (decorated.has(key)) continue;
      decorated.add(key);
      Object.defineProperty(ContextClass.prototype, key, {
        value: own[key],
        writable: true,
        configurable: true,
      });
    }
  }

  const visited = new Set<App<any, any, any, any, any>>();
  const visit = (
    app: App<any, any, any, any, any>,
    chain: Hook[],
    prefix: string,
    parentOwn: LiftedHook[],
  ) => {
    visited.add(app);
    const own = effectiveHooks(app, included, cache);
    // A parent's hooks apply to its children, minus the ones it lifted from
    // this very child (the child already has those as its own).
    const ancestors = [...chain];
    for (const lifted of parentOwn) if (lifted.from !== app) ancestors.push(lifted.hook);
    const hooks = [...ancestors];
    for (const lifted of own) hooks.push(lifted.hook);
    const fullPrefix = joinPrefix(prefix, app.config.prefix);
    for (const def of App.internals(app).routes) {
      const path = joinPath(fullPrefix, def.path);
      router.add(def.method, path, compileRoute(def, path, hooks));
    }
    for (const entry of App.internals(app).entries) {
      if ("child" in entry && included.has(entry.child) && !visited.has(entry.child)) {
        visit(entry.child, ancestors, fullPrefix, own);
      }
    }
  };
  visit(root, [], "", []);

  const lists = split(effectiveHooks(root, included, cache).map((lifted) => lifted.hook));
  return new Compiled(router, lists, ContextClass, App.internals(root).store, root.config.cookie);
}

function joinPrefix(prefix: string, own: string | undefined): string {
  if (!own) return prefix;
  const normalized = own.startsWith("/") ? own : `/${own}`;
  return prefix + (normalized.endsWith("/") ? normalized.slice(0, -1) : normalized);
}

function split(hooks: Hook[]): HookLists {
  const lists = emptyLists();
  for (const hook of hooks) lists[hook.kind].push(hook);
  return lists;
}

export function joinPath(prefix: string, path: string): string {
  if (!prefix) return path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  if (path === "/" || path === "") return prefix;
  return prefix + (path.startsWith("/") ? path : `/${path}`);
}

// ─── Per-request context ─────────────────────────────────────────────────────

/** The object every hook and handler of one request receives. */
export class RequestContext implements RuntimeContext {
  request: Request;
  path: string;
  route: string;
  params: ParamRecord;
  set: SetContext;
  store: Record<string, unknown>;
  server: Server | null;
  body: unknown;
  response: unknown;
  error: unknown;
  _qi: number;
  _query: Record<string, unknown> | undefined;
  _headers: Record<string, string> | undefined;
  _cookies: RequestCookies | undefined;
  _cookieConfig: CookieConfig | undefined;
  _route: CompiledRoute | undefined;
  declare status: typeof status;

  constructor(
    request: Request,
    url: string,
    server: Server | null,
    store: Record<string, unknown>,
    cookieConfig: CookieConfig | undefined,
  ) {
    // Path and query offsets without `new URL()`.
    const scheme = url.indexOf("://");
    const start = scheme === -1 ? 0 : url.indexOf("/", scheme + 3);
    let qi = -1;
    let path: string;
    if (start === -1) {
      path = "/";
    } else {
      const q = url.indexOf("?", start);
      const h = url.indexOf("#", start);
      const end = q === -1 ? (h === -1 ? url.length : h) : h !== -1 && h < q ? h : q;
      path = url.slice(start, end) || "/";
      if (q !== -1 && (h === -1 || q < h)) qi = q + 1;
    }
    this.request = request;
    this.path = path;
    this.route = "";
    this.params = EMPTY_PARAMS;
    this.set = { status: 200, headers: {} };
    this.store = store;
    this.server = server;
    this.body = undefined;
    this.response = undefined;
    this.error = undefined;
    this._qi = qi;
    this._query = undefined;
    this._headers = undefined;
    this._cookies = undefined;
    this._cookieConfig = cookieConfig;
    this._route = undefined;
  }

  get query(): Record<string, unknown> {
    return (this._query ??= this._qi === -1 ? {} : parseQuery(this.request.url.slice(this._qi)));
  }
  set query(value: Record<string, unknown>) {
    this._query = value;
  }

  get headers(): Record<string, string> {
    const cached = this._headers;
    if (cached !== undefined) return cached;
    const headers: Record<string, string> = {};
    this.request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    this._headers = headers;
    return headers;
  }
  set headers(value: Record<string, string>) {
    this._headers = value;
  }

  get cookie() {
    return (this._cookies ??= new RequestCookies(
      this.request.headers.get("cookie"),
      this._cookieConfig,
    )).jar();
  }

  /** Alias of `response` in after-handle hooks. */
  get responseValue(): unknown {
    return this.response;
  }

  redirect(url: string, code: 301 | 302 | 303 | 307 | 308 = 302): StatusResult {
    this.set.headers.location = url;
    return new StatusResult(code, undefined);
  }
}
RequestContext.prototype.status = status;

const EMPTY_PARAMS: Record<string, string> = Object.freeze({}) as Record<string, string>;

// ─── Routes ──────────────────────────────────────────────────────────────────

type Check = (value: unknown) => unknown;

interface CompiledRoute {
  path: string;
  method: string;
  /** The handler function, or `undefined` for a static value route. */
  handler: Fn | undefined;
  /** Static route value, pre-serialized when it is JSON or text. */
  value: unknown;
  hooks: HookLists;
  params: Check | undefined;
  query: Check | undefined;
  headers: Check | undefined;
  body: Check | undefined;
  parse: boolean;
}

/** A static route body serialized once at compile time. */
class Prebuilt {
  /** Cloned for plain 200 responses, which is cheaper than building one. */
  readonly response: Response;
  readonly body: string;
  readonly type: string;
  constructor(body: string, type: string) {
    this.body = body;
    this.type = type;
    this.response = new Response(body, { headers: { "content-type": type } });
  }
}

const validators = new WeakMap<object, ReturnType<typeof Compile>>();

function validator(schema: TSchema): ReturnType<typeof Compile> {
  let v = validators.get(schema as object);
  if (!v) validators.set(schema as object, (v = Compile(schema)));
  return v;
}

function compileCheck(
  schema: TSchema | undefined,
  target: ValidationTarget,
  coerce: boolean,
): Check | undefined {
  if (!schema) return undefined;
  const v = validator(schema);
  return (value) => {
    if (v.Check(value)) return value;
    if (coerce) {
      const converted = v.Convert(structuredClone(value));
      if (v.Check(converted)) return converted;
      throw new ValidationError(target, value, v.Errors(converted) as ValidationIssue[]);
    }
    throw new ValidationError(target, value, v.Errors(value) as ValidationIssue[]);
  };
}

function isPlainObject(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype || proto === null;
}

function compileRoute(def: RouteDef, path: string, inherited: Hook[]): CompiledRoute {
  const options = def.options ?? {};
  const hooks = split(inherited);
  const local = (kind: HookKind, value: unknown) => {
    if (value === undefined) return;
    for (const fn of Array.isArray(value) ? value : [value]) {
      if (typeof fn !== "function") continue;
      hooks[kind].push({ kind, fn: fn as Fn, scope: "local" });
    }
  };
  local("transform", options.transform);
  local("beforeHandle", options.beforeHandle);
  local("afterHandle", options.afterHandle);
  local("mapResponse", options.mapResponse);
  local("error", options.error);
  local("afterResponse", options.afterResponse);
  const handler = typeof def.handler === "function" ? (def.handler as Fn) : undefined;
  let value = def.handler;
  if (handler === undefined) {
    if (typeof value === "string") value = new Prebuilt(value, TEXT_TYPE);
    else if (isPlainObject(value)) value = new Prebuilt(JSON.stringify(value), JSON_TYPE);
  }
  return {
    path,
    method: def.method,
    handler,
    value,
    hooks,
    params: compileCheck(options.params, "params", true),
    query: compileCheck(options.query, "query", true),
    headers: compileCheck(options.headers, "headers", true),
    body: compileCheck(options.body, "body", false),
    parse: def.method !== "GET" && def.method !== "HEAD",
  };
}

// ─── Request pipeline ────────────────────────────────────────────────────────
//
// Every step runs synchronously and only switches to a promise continuation
// when a hook or handler actually returns one, so fully synchronous routes
// never allocate an async frame.

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === "object" || typeof value === "function") &&
  typeof (value as { then?: unknown }).then === "function";

type Result = Response | Promise<Response>;

class Compiled {
  constructor(
    readonly router: Router<CompiledRoute>,
    readonly hooks: HookLists,
    readonly Context: new (...args: ConstructorParameters<typeof RequestContext>) => RequestContext,
    readonly store: Record<string, unknown>,
    readonly cookieConfig: CookieConfig | undefined,
  ) {}

  serve(request: Request, server: Server | null): Result {
    const ctx = new this.Context(request, request.url, server, this.store, this.cookieConfig);
    let result: Result;
    try {
      result = this.requestPhase(ctx, 0);
    } catch (error) {
      result = this.fail(ctx, error);
    }
    if (result instanceof Response) return this.done(ctx, result);
    return result.then(
      (response) => this.done(ctx, response),
      (error) =>
        Promise.resolve(this.fail(ctx, error)).then((response) => this.done(ctx, response)),
    );
  }

  private fail(ctx: RequestContext, error: unknown): Result {
    return respondError(ctx, error, ctx._route ? ctx._route.hooks.error : this.hooks.error);
  }

  private done(ctx: RequestContext, response: Response): Response {
    ctx.set.status = response.status;
    ctx.response = response;
    const after = ctx._route ? ctx._route.hooks.afterResponse : this.hooks.afterResponse;
    if (after.length > 0) runAfterResponse(after, ctx);
    return response;
  }

  private requestPhase(ctx: RequestContext, from: number): Result {
    const hooks = this.hooks.request;
    for (let i = from; i < hooks.length; i++) {
      const r = hooks[i]!.fn(ctx);
      if (isThenable(r)) {
        return Promise.resolve(r).then((v) =>
          v !== undefined ? toResponse(v, ctx) : this.requestPhase(ctx, i + 1),
        );
      }
      if (r !== undefined) return toResponse(r, ctx);
    }
    const router = this.router;
    const route = router.find(ctx.request.method, ctx.path);
    if (route === undefined) throw new NotFoundError();
    ctx._route = route;
    ctx.params = router.params;
    ctx.route = route.path;
    const type = route.parse ? ctx.request.headers.get("content-type") : null;
    if (type !== null) {
      return parseBody(ctx.request, type).then((body) => {
        ctx.body = body;
        return transformPhase(route, ctx, 0);
      });
    }
    return transformPhase(route, ctx, 0);
  }
}

function transformPhase(route: CompiledRoute, ctx: RequestContext, from: number): Result {
  const hooks = route.hooks.transform;
  for (let i = from; i < hooks.length; i++) {
    const r = hooks[i]!.fn(ctx);
    if (isThenable(r)) {
      return Promise.resolve(r).then((v) => {
        const early = applyDerived(ctx, v);
        return early !== undefined
          ? afterPhase(route, ctx, early, 0)
          : transformPhase(route, ctx, i + 1);
      });
    }
    const early = applyDerived(ctx, r);
    if (early !== undefined) return afterPhase(route, ctx, early, 0);
  }
  if (route.params) ctx.params = route.params(ctx.params) as Record<string, string>;
  if (route.query) ctx.query = route.query(ctx.query) as Record<string, unknown>;
  if (route.headers) ctx.headers = route.headers(ctx.headers) as Record<string, string>;
  if (route.body) ctx.body = route.body(ctx.body);
  return beforePhase(route, ctx, 0);
}

/** Merges a derive result; returns a value when it short-circuits the request. */
function applyDerived(ctx: RequestContext, value: unknown): unknown {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  if (value instanceof StatusResult || value instanceof Response) return value;
  Object.assign(ctx, value);
  return undefined;
}

function beforePhase(route: CompiledRoute, ctx: RequestContext, from: number): Result {
  const hooks = route.hooks.beforeHandle;
  for (let i = from; i < hooks.length; i++) {
    const r = hooks[i]!.fn(ctx);
    if (isThenable(r)) {
      return Promise.resolve(r).then((v) =>
        v !== undefined ? afterPhase(route, ctx, v, 0) : beforePhase(route, ctx, i + 1),
      );
    }
    if (r !== undefined) return afterPhase(route, ctx, r, 0);
  }
  const handler = route.handler;
  if (handler === undefined) return afterPhase(route, ctx, route.value, 0);
  const value = handler(ctx);
  if (isThenable(value)) {
    return Promise.resolve(value).then((v) => afterPhase(route, ctx, v, 0));
  }
  return afterPhase(route, ctx, value, 0);
}

function afterPhase(
  route: CompiledRoute,
  ctx: RequestContext,
  value: unknown,
  from: number,
): Result {
  const hooks = route.hooks.afterHandle;
  if (hooks.length > from) {
    ctx.response = value;
    for (let i = from; i < hooks.length; i++) {
      const r = hooks[i]!.fn(ctx);
      if (isThenable(r)) {
        return Promise.resolve(r).then((v) => {
          if (v !== undefined) ctx.response = v;
          return afterPhase(route, ctx, ctx.response, i + 1);
        });
      }
      if (r !== undefined) ctx.response = r;
    }
    value = ctx.response;
  }
  return mapPhase(route, ctx, value, 0);
}

function mapPhase(route: CompiledRoute, ctx: RequestContext, value: unknown, from: number): Result {
  const hooks = route.hooks.mapResponse;
  if (hooks.length > from) {
    ctx.response = value;
    for (let i = from; i < hooks.length; i++) {
      const r = hooks[i]!.fn(ctx);
      if (isThenable(r)) {
        return Promise.resolve(r).then((v) =>
          v !== undefined ? toResponse(v, ctx) : mapPhase(route, ctx, value, i + 1),
        );
      }
      if (r !== undefined) return toResponse(r, ctx);
    }
  }
  return toResponse(value, ctx);
}

function runAfterResponse(hooks: Hook[], ctx: RequestContext): void {
  void Promise.resolve().then(async () => {
    for (const hook of hooks) {
      try {
        await hook.fn(ctx);
      } catch (error) {
        console.error("afterResponse hook failed:", error);
      }
    }
  });
}

function respondError(ctx: RequestContext, error: unknown, hooks: Hook[]): Result {
  if (error instanceof StatusResult || error instanceof Response) return toResponse(error, ctx);
  ctx.error = error;
  ctx.set.status = errorStatus(error);
  return errorPhase(ctx, hooks, 0);
}

function errorPhase(ctx: RequestContext, hooks: Hook[], from: number): Result {
  for (let i = from; i < hooks.length; i++) {
    const hook = hooks[i]!;
    if (hook.match && !(ctx.error instanceof hook.match)) continue;
    let r: unknown;
    try {
      r = hook.fn(ctx);
    } catch (thrown) {
      if (thrown instanceof StatusResult || thrown instanceof Response)
        return toResponse(thrown, ctx);
      ctx.error = thrown;
      continue;
    }
    if (isThenable(r)) {
      return Promise.resolve(r).then(
        (v) => (v !== undefined ? toResponse(v, ctx) : errorPhase(ctx, hooks, i + 1)),
        (thrown) => {
          if (thrown instanceof StatusResult || thrown instanceof Response) {
            return toResponse(thrown, ctx);
          }
          ctx.error = thrown;
          return errorPhase(ctx, hooks, i + 1);
        },
      );
    }
    if (r !== undefined) return toResponse(r, ctx);
  }
  return defaultErrorResponse(ctx.error, ctx);
}

function errorStatus(error: unknown): number {
  const code = (error as { status?: unknown } | null)?.status;
  return typeof code === "number" && code >= 400 && code < 600 ? code : 500;
}

function defaultErrorResponse(error: unknown, ctx: RequestContext): Response {
  const response =
    error !== null &&
    typeof error === "object" &&
    typeof (error as { toResponse?: unknown }).toResponse === "function"
      ? ((error as { toResponse(): unknown }).toResponse() as Response)
      : internalServerErrorResponse(error);
  return withContextHeaders(response, ctx);
}

// ─── Body parsing ────────────────────────────────────────────────────────────

function parseBody(request: Request, type: string): Promise<unknown> {
  const semi = type.indexOf(";");
  const media =
    type === "application/json"
      ? type
      : (semi === -1 ? type : type.slice(0, semi)).trim().toLowerCase();
  let parsed: Promise<unknown>;
  if (media === "application/json" || media.endsWith("+json")) {
    // An empty JSON body is `undefined`, not a parse error.
    parsed = request.text().then((text) => (text === "" ? undefined : JSON.parse(text)));
  } else if (media === "multipart/form-data") {
    parsed = request.formData().then(formToObject);
  } else if (media === "application/x-www-form-urlencoded") {
    parsed = request.text().then(parseQuery);
  } else if (media === "application/octet-stream") {
    parsed = request.arrayBuffer();
  } else {
    parsed = request.text();
  }
  return parsed.catch((error) => {
    throw new ParseError(error);
  });
}

function formToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    const values = form.getAll(key);
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

// ─── Response mapping ────────────────────────────────────────────────────────

const JSON_TYPE = "application/json;charset=utf-8";
const TEXT_TYPE = "text/plain;charset=utf-8";
// Bun copies a `Headers` init far faster than it converts a plain object, so
// the common inits are built once and reused.
const initCache = new Map<string, ResponseInit>();
function initFor(code: number, type: string): ResponseInit {
  const key = `${code}${type}`;
  let init = initCache.get(key);
  if (init === undefined) {
    init = { status: code, headers: new Headers({ "content-type": type }) };
    if (initCache.size < 512) initCache.set(key, init);
  }
  return init;
}

function hasKeys(record: object): boolean {
  for (const _ in record) return true;
  return false;
}

/** Converts a handler result into a `Response`, applying `ctx.set`. */
export function toResponse(value: unknown, ctx: RequestContext): Response {
  const set = ctx.set;
  let code = typeof set.status === "number" ? set.status : toStatusCode(set.status);
  let headers: Record<string, string | number> = set.headers;
  if (value instanceof StatusResult) {
    code = value.code;
    set.status = code;
    if (value.headers) {
      headers = hasKeys(headers) ? { ...headers, ...value.headers } : value.headers;
    }
    value = value.response;
  }
  if (value instanceof Response) return withContextHeaders(value, ctx, headers);

  const plain = !hasKeys(headers) && ctx._cookies === undefined;
  let body: BodyInit | null;
  let type: string | undefined;
  switch (typeof value) {
    case "string":
      body = value;
      type = TEXT_TYPE;
      break;
    case "undefined":
      body = null;
      break;
    case "number":
    case "boolean":
    case "bigint":
      body = String(value);
      type = TEXT_TYPE;
      break;
    case "object":
      if (value === null) {
        body = null;
      } else if (value instanceof Prebuilt) {
        if (plain && code === 200) return value.response.clone();
        body = value.body;
        type = value.type;
      } else if (
        value instanceof Blob ||
        value instanceof ReadableStream ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        value instanceof FormData ||
        value instanceof URLSearchParams
      ) {
        body = value as BodyInit;
      } else if (value instanceof Error) {
        return defaultErrorResponse(value, ctx);
      } else if (isThenable(value)) {
        throw new TypeError("Unexpected promise in response mapping");
      } else if (plain && code === 200) {
        // Serializes and sets the content type natively.
        return Response.json(value);
      } else {
        body = JSON.stringify(value);
        type = JSON_TYPE;
      }
      break;
    default:
      body = String(value);
      type = TEXT_TYPE;
  }

  if (plain) {
    if (type !== undefined) return new Response(body, initFor(code, type));
    return code === 200 ? new Response(body) : new Response(body, { status: code });
  }
  const h = new Headers(headers as Record<string, string>);
  if (type !== undefined && !h.has("content-type")) h.set("content-type", type);
  const cookies = ctx._cookies?.setCookieHeaders();
  if (cookies) for (const cookie of cookies) h.append("set-cookie", cookie);
  return new Response(body, { status: code, headers: h });
}

/** Copies `ctx.set.headers` and pending cookies onto an existing `Response`. */
function withContextHeaders(
  response: Response,
  ctx: RequestContext,
  headers: Record<string, string | number> = ctx.set.headers,
): Response {
  const cookies = ctx._cookies?.setCookieHeaders();
  const extra = hasKeys(headers);
  if (!extra && !(cookies && cookies.length > 0)) return response;
  try {
    applyTo(response.headers, headers, cookies);
    return response;
  } catch {
    // Immutable headers (e.g. a `fetch()` response): copy, then apply.
    const copy = new Response(response.body, response);
    applyTo(copy.headers, headers, cookies);
    return copy;
  }
}

function applyTo(
  target: Headers,
  headers: Record<string, string | number>,
  cookies: string[] | undefined,
): void {
  for (const key in headers) {
    if (!target.has(key)) target.set(key, String(headers[key]));
  }
  if (cookies) for (const cookie of cookies) target.append("set-cookie", cookie);
}

export { HTTP_METHODS };
