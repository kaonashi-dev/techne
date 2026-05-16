import { TypeCompiler } from "@sinclair/typebox/compiler";
import { CATCH_METADATA } from "../../common/constants";
import { ForbiddenException } from "../../exceptions";
import type { ExceptionFilter } from "../../interfaces/exception-filter.interface";
import type { ResponseHook } from "../../interfaces/response-hook.interface";
import { Logger } from "../../services/logger.service";
import { compileStringifier } from "../../schema/fast-stringify";
import type { ParamMetadata } from "../../decorators/params.decorator";
import { HandlerMetadataStorage } from "./handler-metadata-storage";
import { RouterResponseController } from "./router-response-controller";
import type { DiscoveredRouteDefinition } from "./router-explorer";

type RequestHandlerContext = any;
type RouteContextInfo = {
  readonly ctx: RequestHandlerContext;
  readonly controller: Function;
  readonly handler: Function;
};
type CompiledArgsBinder = (
  context: RequestHandlerContext,
  routeContext: RouteContextInfo | undefined,
) => any[];

interface GuardEntry {
  readonly guard: any;
  readonly contextual: boolean;
}

export interface CompiledRouteDefinition {
  method: DiscoveredRouteDefinition["method"];
  fullPath: string;
  schema?: DiscoveredRouteDefinition["schema"];
  beforeHandle?: any[];
  handler: (context: RequestHandlerContext) => unknown;
}

interface CachedHandlerMetadata {
  bindArgs: CompiledArgsBinder;
  hasCustomParam: boolean;
}

interface ContainerLike {
  get<T>(token: any): T;
  resolve<T>(token: any, context?: { request?: any; inquirer?: any }): T;
  isStatic(token: any): boolean;
  clearContext(contextIdOrRequest: symbol | object): void;
  hasContextualDeps?(token: any): boolean;
}

interface RouteRuntimeCache {
  container: ContainerLike;
  routeFilters: any[];
  routeResponseHooks: any[];
  staticFilters: ExceptionFilter[];
  contextualFilters: any[];
  staticResponseHooks: ResponseHook[];
  contextualResponseHooks: any[];
  hasRuntimeEnhancers: boolean;
  hasGuards: boolean;
  hasFilters: boolean;
  hasResponseHooks: boolean;
  hasRequestScopedDeps: boolean;
  responseStringifier?: (v: unknown) => string;
  responseValidator?: { Check(value: unknown): boolean };
  controllerClass?: any;
  guards: any[];
  // The compiled per-request closure. Selected at compile time based on
  // enhancers/req-scoped deps so the hot path never re-checks those flags.
  // Swapped by `refreshRouteCache` when global filters change post-boot.
  handler: (context: RequestHandlerContext) => unknown;
  // Compile inputs retained so we can recompile when the cache flags change.
  recompile?: () => void;
  // Version snapshots from the last `refreshRouteCache`. When the live
  // `globalFiltersVersion`/`globalGuardsVersion` still match, the filter merge
  // + partition is unchanged and we can reuse `staticFilters` /
  // `contextualFilters` from the previous refresh. `-1` means "never refreshed
  // yet" so the initial pass always runs.
  lastGlobalFiltersVersion: number;
  lastGlobalGuardsVersion: number;
  // True once `partitionRouteInstances` has been run on `routeResponseHooks`.
  // The per-route response hooks list is immutable after `create`, so a single
  // partition is sufficient for the lifetime of the cache.
  responseHooksPartitioned: boolean;
}

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);

const JSON_CONTENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "application/json; charset=utf-8",
});
const RESPONSE_INIT_OK: ResponseInit = Object.freeze({
  status: 200,
  headers: JSON_CONTENT_TYPE as Record<string, string>,
}) as ResponseInit;

function mergeArrays<T>(globals: T[], route: T[]): T[] {
  if (globals.length === 0) return route;
  if (route.length === 0) return globals;
  return [...globals, ...route];
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return !!value && (typeof value === "object" || typeof value === "function") && "then" in value;
}

const filterCatchTypesCache = new WeakMap<Function, Function[] | undefined>();

function getFilterCatchTypes(filter: ExceptionFilter): Function[] | undefined {
  const ctor = (filter as any)?.constructor;
  if (typeof ctor !== "function") return undefined;
  if (filterCatchTypesCache.has(ctor)) return filterCatchTypesCache.get(ctor);
  const types = Reflect.getMetadata(CATCH_METADATA, ctor) as Function[] | undefined;
  const resolved = types && types.length > 0 ? types : undefined;
  filterCatchTypesCache.set(ctor, resolved);
  return resolved;
}

function filterShouldCatch(filter: ExceptionFilter, error: unknown): boolean {
  const types = getFilterCatchTypes(filter);
  if (!types) return true;
  for (const type of types) {
    if (error instanceof (type as any)) return true;
  }
  return false;
}

type ParamExtractor = (ctx: any, routeContext: RouteContextInfo | undefined) => unknown;
type FastParamExtractor = (ctx: any) => unknown;

function createExtractor(param: ParamMetadata, fast: true): FastParamExtractor | null;
function createExtractor(param: ParamMetadata, fast: false): ParamExtractor;
function createExtractor(
  param: ParamMetadata,
  fast: boolean,
): ParamExtractor | FastParamExtractor | null {
  const name = param.name;
  switch (param.type) {
    case "body":
      return name ? (ctx: any) => ctx.body?.[name] : (ctx: any) => ctx.body;
    case "file":
      return (ctx: any) => {
        const body = ctx.body;
        if (name) {
          if (body instanceof FormData) return body.get(name);
          return body?.[name];
        }
        if (body instanceof FormData) {
          const first = body.entries().next();
          return first.done ? undefined : first.value[1];
        }
        return body;
      };
    case "param":
      return name ? (ctx: any) => ctx.params?.[name] : (ctx: any) => ctx.params;
    case "query":
      return name ? (ctx: any) => ctx.query?.[name] : (ctx: any) => ctx.query;
    case "headers":
      return name ? (ctx: any) => ctx.headers?.[name] : (ctx: any) => ctx.headers;
    case "request":
      return (ctx: any) => ctx.request;
    case "custom": {
      if (fast) return null;
      const factory = param.factory;
      const data = param.data;
      if (!factory) return () => undefined;
      return (_ctx: any, routeContext: RouteContextInfo | undefined) =>
        factory(data, routeContext as any);
    }
    default:
      return () => undefined;
  }
}

/**
 * Returns the per-param access expression for the emitted fast-handler
 * codegen path, or `null` if the descriptor is not safe to inline (custom
 * factories, file uploads with FormData branching, etc.). The caller falls
 * back to {@link compileFastHandler} when this returns `null`.
 *
 * All property reads use bracketed `JSON.stringify`-encoded keys so user-
 * provided param names (e.g. `@Query("page-size")`) can't escape into the
 * source string and break parsing.
 */
function paramAccessExpression(param: ParamMetadata): string | null {
  const name = param.name;
  switch (param.type) {
    case "body":
      return name ? `(ctx.body==null?undefined:ctx.body[${JSON.stringify(name)}])` : `ctx.body`;
    case "param":
      return name
        ? `(ctx.params==null?undefined:ctx.params[${JSON.stringify(name)}])`
        : `ctx.params`;
    case "query":
      return name ? `(ctx.query==null?undefined:ctx.query[${JSON.stringify(name)}])` : `ctx.query`;
    case "headers":
      return name
        ? `(ctx.headers==null?undefined:ctx.headers[${JSON.stringify(name)}])`
        : `ctx.headers`;
    case "request":
      return `ctx.request`;
    // `file` needs FormData branching; `custom` needs the factory invocation
    // path with routeContext — both stay in the bind-based fast path.
    default:
      return null;
  }
}

const COMPILED_HANDLERS_ENABLED = process.env.TECHNE_COMPILED_HANDLERS === "1";

/**
 * Compile-time codegen variant of {@link compileFastHandler} that emits a
 * single specialized closure per route via `new Function(...)`, inlining
 * literal property access (e.g. `instance.create(ctx.body, ctx.params["id"])`)
 * instead of going through three bound extractor calls plus `.bind`.
 *
 * Returns `null` when any descriptor isn't safe to inline (file/custom params,
 * non-contiguous indexes, malformed method name) — the caller then falls back
 * to {@link compileFastHandler}.
 */
function compileFastHandlerEmitted(
  instance: any,
  methodName: string,
  paramsMetadata: ParamMetadata[],
  logger?: { debug?: (msg: string) => void },
): ((ctx: any) => unknown) | null {
  // Param indexes must be contiguous 0..n-1 (same constraint the bind-based
  // fast path enforces).
  for (let i = 0; i < paramsMetadata.length; i++) {
    if (paramsMetadata[i].index !== i) return null;
  }

  // Reject anything we'd have to template into the source string as a raw
  // identifier. JS identifiers are conservative on purpose — anything weird
  // falls through to the bind-based path.
  if (!/^[A-Za-z_$][\w$]*$/.test(methodName)) return null;

  const accessors: string[] = [];
  for (const param of paramsMetadata) {
    const expr = paramAccessExpression(param);
    if (expr === null) return null;
    accessors.push(expr);
  }

  const source =
    accessors.length === 0
      ? `return function(ctx){return instance.${methodName}();};`
      : `return function(ctx){return instance.${methodName}(${accessors.join(",")});};`;

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function("instance", source) as (i: any) => (ctx: any) => unknown;
    return factory(instance);
  } catch (err) {
    logger?.debug?.(
      `compileFastHandlerEmitted: new Function failed for ${methodName} (${(err as Error).message}); falling back`,
    );
    return null;
  }
}

function compileFastHandler(
  instance: any,
  methodName: string,
  paramsMetadata: ParamMetadata[],
): ((ctx: any) => unknown) | null {
  if (paramsMetadata.length === 0) {
    return () => instance[methodName]();
  }

  for (let i = 0; i < paramsMetadata.length; i++) {
    if (paramsMetadata[i].index !== i) return null;
  }

  const method = instance[methodName] as (...args: any[]) => unknown;
  const call = method.bind(instance);
  const extractors: FastParamExtractor[] = [];
  for (let i = 0; i < paramsMetadata.length; i++) {
    const extractor = createExtractor(paramsMetadata[i], true);
    if (!extractor) return null;
    extractors.push(extractor);
  }

  switch (extractors.length) {
    case 1: {
      const e0 = extractors[0];
      return (ctx) => call(e0(ctx));
    }
    case 2: {
      const e0 = extractors[0];
      const e1 = extractors[1];
      return (ctx) => call(e0(ctx), e1(ctx));
    }
    case 3: {
      const e0 = extractors[0];
      const e1 = extractors[1];
      const e2 = extractors[2];
      return (ctx) => call(e0(ctx), e1(ctx), e2(ctx));
    }
    case 4: {
      const e0 = extractors[0];
      const e1 = extractors[1];
      const e2 = extractors[2];
      const e3 = extractors[3];
      return (ctx) => call(e0(ctx), e1(ctx), e2(ctx), e3(ctx));
    }
    default: {
      const n = extractors.length;
      return (ctx) => {
        // oxlint-disable-next-line no-new-array -- pre-sized for hot path
        const args = new Array(n);
        for (let i = 0; i < n; i++) args[i] = extractors[i](ctx);
        return call(...args);
      };
    }
  }
}

export class RouterExecutionContext {
  private readonly handlerMetadataStorage = new HandlerMetadataStorage<CachedHandlerMetadata>();
  private readonly routeCaches: RouteRuntimeCache[] = [];
  private readonly logger = new Logger("RouterExecutionContext");
  private globalFilters: ExceptionFilter[] = [];
  private globalGuards: any[] = [];
  // Monotonically bumped whenever the corresponding `globalX` array reference
  // is replaced via `setGlobalX`. `refreshRouteCache` compares against the
  // per-cache snapshot to skip the filter merge + partition when nothing has
  // changed since the last refresh (B3).
  private globalFiltersVersion = 0;
  private globalGuardsVersion = 0;
  private routesRegistered = false;
  private validateResponses = false;

  constructor(private readonly responseController: RouterResponseController) {}

  public setValidateResponses(value: boolean): void {
    this.validateResponses = value;
  }

  public setGlobalFilters(filters: ExceptionFilter[]) {
    this.globalFilters = filters;
    this.globalFiltersVersion++;
    for (const cache of this.routeCaches) {
      this.refreshRouteCache(cache);
      cache.recompile?.();
    }
  }

  public setGlobalGuards(guards: any[]): boolean {
    this.globalGuards = guards;
    this.globalGuardsVersion++;
    return !this.routesRegistered;
  }

  public getGlobalGuards(): any[] {
    return this.globalGuards;
  }

  public resetRoutes(): void {
    this.routeCaches.length = 0;
  }

  public create(route: DiscoveredRouteDefinition, container: ContainerLike) {
    this.routesRegistered = true;
    const metadata = this.getMetadata(route);
    const controllerClass = route.controller;
    const handlerRef = route.controller.prototype[route.handlerName] as Function;
    const mergedGuards =
      this.globalGuards.length === 0 ? route.guards : [...this.globalGuards, ...route.guards];
    const guardHook = this.createGuardHook(mergedGuards, container, controllerClass, handlerRef);
    const beforeHandle = guardHook
      ? [guardHook, ...route.middlewares]
      : route.middlewares.length === 0
        ? undefined
        : route.middlewares;

    const cache: RouteRuntimeCache = {
      container,
      routeFilters: route.filters,
      routeResponseHooks: route.responseHooks,
      staticFilters: [],
      contextualFilters: [],
      staticResponseHooks: [],
      contextualResponseHooks: [],
      hasRuntimeEnhancers: false,
      hasGuards: mergedGuards.length > 0,
      hasFilters: false,
      hasResponseHooks: false,
      hasRequestScopedDeps: false,
      controllerClass,
      guards: mergedGuards,
      // Placeholder; replaced before `create` returns.
      handler: () => undefined,
      // -1 forces the first `refreshRouteCache` pass to run the full partition.
      lastGlobalFiltersVersion: -1,
      lastGlobalGuardsVersion: -1,
      responseHooksPartitioned: false,
    };

    if (route.schema?.response) {
      try {
        cache.responseStringifier = compileStringifier(route.schema.response as any);
      } catch {
        cache.responseStringifier = undefined;
      }
      if (this.validateResponses) {
        try {
          cache.responseValidator = TypeCompiler.Compile(route.schema.response as any);
        } catch {
          cache.responseValidator = undefined;
        }
      }
    }

    cache.recompile = () => {
      cache.handler = this.compileHandler(
        route,
        metadata,
        cache,
        controllerClass,
        handlerRef,
        container,
      );
    };

    this.refreshRouteCache(cache);
    this.routeCaches.push(cache);
    cache.recompile();

    // Outer Elysia-registered wrapper indirects through `cache.handler` so that
    // a post-boot `refreshRouteCache` recompile (e.g. global filters change)
    // can swap the closure without re-registering with Elysia.
    const handler = (context: RequestHandlerContext) => cache.handler(context);

    return {
      method: route.method,
      fullPath: route.fullPath,
      schema: route.schema,
      beforeHandle,
      handler,
    } satisfies CompiledRouteDefinition;
  }

  private compileHandler(
    route: DiscoveredRouteDefinition,
    metadata: CachedHandlerMetadata,
    cache: RouteRuntimeCache,
    controllerClass: any,
    handlerRef: Function,
    container: ContainerLike,
  ): (context: RequestHandlerContext) => unknown {
    const handlerName = route.handlerName;
    const paramsMetadata = route.paramsMetadata;
    const bindArgs = metadata.bindArgs;
    const hasCustomParam = metadata.hasCustomParam;

    // Boot-time decision: a route with neither a response validator nor a
    // response stringifier has nothing to do in `maybeStringify`. We emit a
    // closure that skips the call entirely so the per-request hot path never
    // touches the validator/stringifier fields on the cache.
    const needsResponseWork =
      cache.responseValidator !== undefined || cache.responseStringifier !== undefined;

    // Fast path: no enhancers, no request-scoped deps, static controller, and
    // a compileable param layout. The runtime flag check is gone — recompile
    // (via `cache.recompile`) re-selects this branch when flags change.
    if (!cache.hasRuntimeEnhancers && !cache.hasRequestScopedDeps) {
      const fastController = container.isStatic(controllerClass)
        ? container.get<any>(controllerClass)
        : undefined;
      let fast: ((ctx: any) => unknown) | null = null;
      if (fastController) {
        // Opt-in compile-time codegen: emit a single per-route closure with
        // literal property reads. Falls through to the bind-based path on any
        // non-inlinable descriptor (file/custom) or a `new Function` failure.
        if (COMPILED_HANDLERS_ENABLED) {
          fast = compileFastHandlerEmitted(
            fastController,
            handlerName,
            paramsMetadata,
            this.logger,
          );
        }
        if (!fast) {
          fast = compileFastHandler(fastController, handlerName, paramsMetadata);
        }
      }
      if (fast) {
        return needsResponseWork
          ? this.createFastHandlerWithResponseWork(fast, cache)
          : this.createFastHandlerNoResponseWork(fast);
      }
    }

    return this.createSlowHandler(
      cache,
      controllerClass,
      handlerRef,
      handlerName,
      bindArgs,
      hasCustomParam,
      container,
    );
  }

  private createFastHandlerWithResponseWork(
    fast: (ctx: any) => unknown,
    cache: RouteRuntimeCache,
  ): (context: RequestHandlerContext) => unknown {
    const responseController = this.responseController;
    return (context: RequestHandlerContext) => {
      try {
        const result = fast(context);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(
            (resolved) => this.maybeStringify(context, cache, resolved),
            (err) => responseController.mapException(context, err),
          );
        }
        return this.maybeStringify(context, cache, result);
      } catch (error) {
        return responseController.mapException(context, error);
      }
    };
  }

  private createFastHandlerNoResponseWork(
    fast: (ctx: any) => unknown,
  ): (context: RequestHandlerContext) => unknown {
    const responseController = this.responseController;
    return (context: RequestHandlerContext) => {
      try {
        const result = fast(context);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(undefined, (err) =>
            responseController.mapException(context, err),
          );
        }
        return result;
      } catch (error) {
        return responseController.mapException(context, error);
      }
    };
  }

  private createSlowHandler(
    cache: RouteRuntimeCache,
    controllerClass: any,
    handlerRef: Function,
    handlerName: string,
    bindArgs: CompiledArgsBinder,
    hasCustomParam: boolean,
    container: ContainerLike,
  ): (context: RequestHandlerContext) => unknown {
    const responseController = this.responseController;
    return (context: RequestHandlerContext) => {
      const resolutionContext = cache.hasRequestScopedDeps ? { request: context } : undefined;
      const controllerInstance = resolutionContext
        ? this.resolveInstance<any>(controllerClass, container, resolutionContext)
        : container.get<any>(controllerClass);
      const mergedFilters = this.resolveRouteInstances<ExceptionFilter>(
        cache.staticFilters,
        cache.contextualFilters,
        container,
        resolutionContext,
      );
      const mergedResponseHooks = this.resolveRouteInstances<ResponseHook>(
        cache.staticResponseHooks,
        cache.contextualResponseHooks,
        container,
        resolutionContext,
      );

      let routeContext: RouteContextInfo | undefined;
      const getRouteContext = () => {
        routeContext ??= { ctx: context, controller: controllerClass, handler: handlerRef };
        return routeContext;
      };

      const handleException = (error: unknown) => {
        for (let i = mergedFilters.length - 1; i >= 0; i--) {
          const filter = mergedFilters[i];
          if (!filterShouldCatch(filter, error)) continue;
          try {
            return filter.catch(error, getRouteContext() as any);
          } catch {
            // Filter didn't handle it, try next.
          }
        }
        return responseController.mapException(context, error);
      };

      const cleanup = () => {
        if (resolutionContext) {
          container.clearContext(context);
        }
      };
      const withCleanup = (value: unknown): unknown => {
        if (isPromiseLike(value)) {
          return (value as Promise<unknown>).finally(cleanup);
        }
        cleanup();
        return value;
      };
      const finish = (value: unknown) =>
        withCleanup(
          this.finalizeResult(
            context,
            cache,
            value,
            mergedResponseHooks,
            getRouteContext,
            handleException,
          ),
        );
      const fail = (error: unknown) => withCleanup(handleException(error));

      try {
        const args = bindArgs(context, hasCustomParam ? getRouteContext() : undefined);
        const result = controllerInstance[handlerName](...args);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(finish, fail);
        }
        return finish(result);
      } catch (error) {
        return fail(error);
      }
    };
  }

  private finalizeResult(
    context: RequestHandlerContext,
    cache: RouteRuntimeCache,
    result: unknown,
    hooks: ResponseHook[],
    getRouteContext: () => RouteContextInfo,
    handleException: (error: unknown) => unknown,
  ): unknown {
    try {
      const transformed = this.applyResponseHooks(result, hooks, getRouteContext);
      if (isPromiseLike(transformed)) {
        return (transformed as Promise<unknown>).then(
          (resolved) => this.maybeStringify(context, cache, resolved),
          handleException,
        );
      }
      return this.maybeStringify(context, cache, transformed);
    } catch (error) {
      return handleException(error);
    }
  }

  private applyResponseHooks(
    result: unknown,
    hooks: ResponseHook[],
    getRouteContext: () => RouteContextInfo,
  ): unknown {
    if (hooks.length === 0) return result;

    const routeContext = getRouteContext();
    let current = result;
    for (let i = 0; i < hooks.length; i++) {
      if (isPromiseLike(current)) {
        return this.applyResponseHooksAsync(current, hooks, i, routeContext);
      }
      current = hooks[i].transform(current, routeContext as any);
    }
    return current;
  }

  private async applyResponseHooksAsync(
    pending: Promise<unknown>,
    hooks: ResponseHook[],
    start: number,
    routeContext: RouteContextInfo,
  ): Promise<unknown> {
    let current = await pending;
    for (let i = start; i < hooks.length; i++) {
      current = await hooks[i].transform(current, routeContext as any);
    }
    return current;
  }

  private maybeStringify(
    context: RequestHandlerContext,
    cache: RouteRuntimeCache,
    result: unknown,
  ): unknown {
    // Fast-path: nothing to wrap or validate for non-object results, nullish
    // values, or pre-built Responses. Doing this before touching the validator
    // avoids the try/catch frame for the common "controller returned a Response
    // or a primitive" case.
    if (result === undefined || result === null) return result;
    if (result instanceof Response) return result;
    const t = typeof result;
    if (t !== "object") return result;

    const validator = cache.responseValidator;
    if (validator) {
      try {
        if (!validator.Check(result)) {
          this.logger.warn("Response schema validation failed for route result.");
        }
      } catch {
        this.logger.warn("Response schema validation failed for route result.");
      }
    }

    const stringifier = cache.responseStringifier;
    if (!stringifier) return result;
    try {
      const body = stringifier(result);
      const status = (context as any)?.set?.status;
      if (status === undefined || status === 200) {
        return new Response(body, RESPONSE_INIT_OK);
      }
      return new Response(body, {
        status: typeof status === "number" ? status : 200,
        headers: JSON_CONTENT_TYPE as Record<string, string>,
      });
    } catch {
      return result;
    }
  }

  private refreshRouteCache(cache: RouteRuntimeCache): void {
    // B3: skip the filter merge + partition when neither the global filter set
    // nor the global guard set has changed since the last refresh. `routeFilters`
    // is captured from the immutable `route.filters` array in `create` and is
    // never mutated afterward, so the previous partition output is still valid.
    const versionsUnchanged =
      cache.lastGlobalFiltersVersion === this.globalFiltersVersion &&
      cache.lastGlobalGuardsVersion === this.globalGuardsVersion;
    // Bonus bypass: when both inputs are empty AND the previously cached
    // partition outputs are also empty, skip even on the first pass — there is
    // demonstrably no work to do, and the next non-empty `setGlobalFilters`
    // will bump the version and force a recompute.
    const bothInputsEmpty = this.globalFilters.length === 0 && cache.routeFilters.length === 0;
    const bothOutputsEmpty =
      cache.staticFilters.length === 0 && cache.contextualFilters.length === 0;
    const initialPassDone = cache.lastGlobalFiltersVersion !== -1;
    const canSkipFilterPartition =
      (initialPassDone && versionsUnchanged) || (bothInputsEmpty && bothOutputsEmpty);

    if (!canSkipFilterPartition) {
      const filters = this.partitionRouteInstances<ExceptionFilter>(
        mergeArrays(this.globalFilters, cache.routeFilters),
        cache.container,
      );
      cache.staticFilters = filters.staticInstances;
      cache.contextualFilters = filters.contextualTokens;
    }
    // Stamp the version snapshot whether we ran the partition or short-circuited
    // — both paths leave the cache consistent with the current global state.
    cache.lastGlobalFiltersVersion = this.globalFiltersVersion;
    cache.lastGlobalGuardsVersion = this.globalGuardsVersion;

    // `routeResponseHooks` is also immutable post-create, so the partition
    // result is reusable for the lifetime of the cache.
    if (!cache.responseHooksPartitioned) {
      const responseHooks = this.partitionRouteInstances<ResponseHook>(
        cache.routeResponseHooks,
        cache.container,
      );
      cache.staticResponseHooks = responseHooks.staticInstances;
      cache.contextualResponseHooks = responseHooks.contextualTokens;
      cache.responseHooksPartitioned = true;
    }

    // Always recompute the boolean flags + request-scoped-deps check. These
    // are cheap and they read from fields that may have just been refreshed.
    cache.hasFilters = cache.staticFilters.length > 0 || cache.contextualFilters.length > 0;
    cache.hasResponseHooks =
      cache.staticResponseHooks.length > 0 || cache.contextualResponseHooks.length > 0;
    cache.hasRuntimeEnhancers = cache.hasFilters || cache.hasResponseHooks;
    cache.hasRequestScopedDeps = this.computeHasRequestScopedDeps(cache);
  }

  private computeHasRequestScopedDeps(cache: RouteRuntimeCache): boolean {
    const container = cache.container;
    const isContextual = (token: any): boolean => {
      if (typeof token !== "function") return false;
      if (container.hasContextualDeps) return container.hasContextualDeps(token);
      return !container.isStatic(token);
    };

    if (cache.controllerClass && isContextual(cache.controllerClass)) return true;
    for (const guard of cache.guards) {
      if (isContextual(guard)) return true;
    }
    for (const filter of cache.contextualFilters) {
      if (isContextual(filter)) return true;
    }
    for (const filter of cache.routeFilters) {
      if (isContextual(filter)) return true;
    }
    for (const hook of cache.contextualResponseHooks) {
      if (isContextual(hook)) return true;
    }
    for (const hook of cache.routeResponseHooks) {
      if (isContextual(hook)) return true;
    }
    return false;
  }

  private partitionRouteInstances<T>(
    items: any[],
    container: ContainerLike,
  ): { staticInstances: T[]; contextualTokens: any[] } {
    const staticInstances: T[] = [];
    const contextualTokens: any[] = [];

    for (const item of items) {
      if (typeof item !== "function") {
        staticInstances.push(item as T);
        continue;
      }

      if (container.isStatic(item)) {
        staticInstances.push(container.get<T>(item));
        continue;
      }

      contextualTokens.push(item);
    }

    return { staticInstances, contextualTokens };
  }

  private resolveRouteInstances<T>(
    staticInstances: T[],
    contextualTokens: any[],
    container: ContainerLike,
    context?: { request?: any; inquirer?: any },
  ): T[] {
    if (contextualTokens.length === 0) {
      return staticInstances;
    }

    const contextualInstances = this.resolveInstances<T>(contextualTokens, container, context);
    return staticInstances.length === 0
      ? contextualInstances
      : [...staticInstances, ...contextualInstances];
  }

  private resolveInstances<T>(
    classes: any[],
    container: ContainerLike,
    context?: { request?: any; inquirer?: any },
  ): T[] {
    return classes.map((cls) => {
      if (typeof cls !== "function") return cls as T;
      try {
        return context ? container.resolve<T>(cls, context) : container.get<T>(cls);
      } catch {
        return new cls() as T;
      }
    });
  }

  private resolveInstance<T>(
    token: any,
    container: ContainerLike,
    context: { request?: any; inquirer?: any },
  ): T {
    return container.isStatic(token)
      ? container.get<T>(token)
      : container.resolve<T>(token, context);
  }

  private getMetadata(route: DiscoveredRouteDefinition): CachedHandlerMetadata {
    const cached = this.handlerMetadataStorage.get(route.controller, route.handlerName);
    if (cached) {
      return cached;
    }

    const metadata = {
      bindArgs: this.createArgsBinder(route.paramsMetadata),
      hasCustomParam: route.paramsMetadata.some((param) => param.type === "custom"),
    };
    this.handlerMetadataStorage.set(route.controller, route.handlerName, metadata);
    return metadata;
  }

  private createArgsBinder(methodParams: ParamMetadata[]): CompiledArgsBinder {
    if (methodParams.length === 0) {
      return () => EMPTY_ARRAY as unknown as any[];
    }

    let maxIndex = 0;
    for (const param of methodParams) {
      if (param.index > maxIndex) maxIndex = param.index;
    }
    const length = maxIndex + 1;

    if (methodParams.length === 1 && length === 1) {
      const extract = createExtractor(methodParams[0], false);
      return (context, routeContext) => [extract(context, routeContext)];
    }

    const extractors: ParamExtractor[] = [];
    const indexes: number[] = [];
    for (const param of methodParams) {
      extractors.push(createExtractor(param, false));
      indexes.push(param.index);
    }
    const arity = extractors.length;

    return (context, routeContext) => {
      // oxlint-disable-next-line no-new-array -- pre-sized for hot path
      const args = new Array(length);
      for (let i = 0; i < arity; i++) {
        args[indexes[i]] = extractors[i](context, routeContext);
      }
      return args;
    };
  }

  private createGuardHook(
    guards: any[],
    container: ContainerLike,
    controllerClass: any,
    handlerRef: Function,
  ): ((context: RequestHandlerContext) => unknown) | undefined {
    if (guards.length === 0) return undefined;

    const entries: GuardEntry[] = guards.map((guardClass: any) => {
      const isClassToken = typeof guardClass === "function";
      const isStaticGuard =
        !isClassToken ||
        (container.isStatic(guardClass) &&
          (!container.hasContextualDeps || !container.hasContextualDeps(guardClass)));

      if (isStaticGuard) {
        return {
          guard: isClassToken ? container.get<any>(guardClass) : guardClass,
          contextual: false,
        };
      }

      return { guard: guardClass, contextual: true };
    });

    return (context: RequestHandlerContext) => {
      const routeContext: RouteContextInfo = {
        ctx: context,
        controller: controllerClass,
        handler: handlerRef,
      };
      let touchedContextual = false;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const guardInstance = entry.contextual
          ? this.resolveGuardInstance(entry.guard, container, context)
          : entry.guard;
        if (entry.contextual) touchedContextual = true;

        try {
          const result = guardInstance.canActivate(routeContext as any);

          if (isPromiseLike<boolean>(result)) {
            return result
              .then((canActivate) =>
                canActivate
                  ? this.continueGuardEntries(
                      entries,
                      i + 1,
                      context,
                      routeContext,
                      container,
                      touchedContextual,
                    )
                  : this.denyGuard(context, container, touchedContextual),
              )
              .catch((error: unknown) =>
                this.guardError(context, container, touchedContextual, error),
              );
          }

          if (!result) {
            return this.denyGuard(context, container, touchedContextual);
          }
        } catch (error) {
          return this.guardError(context, container, touchedContextual, error);
        }
      }
    };
  }

  private async continueGuardEntries(
    entries: GuardEntry[],
    start: number,
    context: RequestHandlerContext,
    routeContext: RouteContextInfo,
    container: ContainerLike,
    touchedContextual: boolean,
  ): Promise<unknown> {
    let hasContextual = touchedContextual;

    for (let i = start; i < entries.length; i++) {
      const entry = entries[i];
      const guardInstance = entry.contextual
        ? this.resolveGuardInstance(entry.guard, container, context)
        : entry.guard;
      if (entry.contextual) hasContextual = true;

      try {
        const canActivate = await guardInstance.canActivate(routeContext as any);
        if (!canActivate) {
          return this.denyGuard(context, container, hasContextual);
        }
      } catch (error) {
        return this.guardError(context, container, hasContextual, error);
      }
    }
  }

  private resolveGuardInstance(
    guardClass: any,
    container: ContainerLike,
    context: RequestHandlerContext,
  ): any {
    return this.resolveInstance<any>(guardClass, container, { request: context });
  }

  private denyGuard(
    context: RequestHandlerContext,
    container: ContainerLike,
    touchedContextual: boolean,
  ): unknown {
    if (touchedContextual) container.clearContext(context);
    return this.responseController.mapException(context, new ForbiddenException());
  }

  private guardError(
    context: RequestHandlerContext,
    container: ContainerLike,
    touchedContextual: boolean,
    error: unknown,
  ): unknown {
    if (touchedContextual) container.clearContext(context);
    return this.responseController.mapException(context, error);
  }
}
