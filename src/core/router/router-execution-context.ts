import { ForbiddenException } from "../../exceptions";
import { CATCH_METADATA } from "../../common/constants";
import type { ParamMetadata } from "../../decorators/params.decorator";
import type { ExceptionFilter } from "../../interfaces/exception-filter.interface";
import type { TechneInterceptor, CallHandler } from "../../interfaces/interceptor.interface";
import type { PipeTransform, ArgumentMetadata } from "../../interfaces/pipe-transform.interface";
import { ContextIdFactory } from "../context-id-factory";
import { ExecutionContextHost } from "../execution-context";
import { HandlerMetadataStorage } from "./handler-metadata-storage";
import { RouterResponseController } from "./router-response-controller";
import type { DiscoveredRouteDefinition } from "./router-explorer";
import { compileStringifier } from "../../schema/fast-stringify";

type RequestHandlerContext = any;
type CompiledArgsBinder = (
  context: RequestHandlerContext,
  execCtx: ExecutionContextHost | undefined,
) => any[];

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
  resolve<T>(
    token: any,
    context?: { request?: any; contextId?: symbol; inquirer?: any },
  ): T;
  isStatic(token: any): boolean;
  clearContext(contextId: symbol): void;
  hasContextualDeps?(token: any): boolean;
}

type CompiledInterceptorChain = (execCtx: ExecutionContextHost, handler: () => any) => any;

interface RouteRuntimeCache {
  container: ContainerLike;
  routeFilters: any[];
  routeInterceptors: any[];
  routePipes: any[];
  staticFilters: ExceptionFilter[];
  contextualFilters: any[];
  staticInterceptors: TechneInterceptor[];
  contextualInterceptors: any[];
  staticPipes: PipeTransform[];
  contextualPipes: any[];
  hasRuntimeEnhancers: boolean;
  // Cost-tagging: precomputed at boot.
  hasGuards: boolean;
  hasFilters: boolean;
  hasInterceptors: boolean;
  hasPipes: boolean;
  hasRequestScopedDeps: boolean;
  // Optional precompiled response stringifier (only set if response schema declared).
  responseStringifier?: (v: unknown) => string;
  // Cached enhancer tokens for cost-tag refresh.
  controllerClass?: any;
  guards: any[];
  // Pre-compiled static interceptor chain; avoids per-request object allocation.
  compiledStaticInterceptorChain?: CompiledInterceptorChain;
}

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);

// Module-level frozen constants to avoid re-allocating Headers/ResponseInit on
// every typed response. Reused for the common status=200 case in
// `maybeStringify` — the headers object identity is shared across all
// responses, which is safe because `Response` snapshots the init eagerly.
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

// Cache @Catch() metadata per filter class. `undefined` = catch-all (no
// decorator or @Catch() with no args).
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
  if (!types) return true; // catch-all
  for (const type of types) {
    if (error instanceof (type as any)) return true;
  }
  return false;
}

type ParamExtractor = (ctx: any, execCtx: ExecutionContextHost | undefined) => unknown;
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
      return (_ctx: any, execCtx: ExecutionContextHost | undefined) => factory(data, execCtx as any);
    }
    default:
      return () => undefined;
  }
}

/**
 * Compile a directly-callable handler for routes with any positional arity.
 * Returns `null` for shapes we can't specialize (non-positional indexes or
 * custom params) so the caller falls back to the generic args-array path.
 *
 * Routes with `custom` params are excluded from the fast path because they
 * need an `ExecutionContextHost` allocation — they fall through to the slow
 * path which manages that lifecycle.
 */
function compileFastHandler(
  instance: any,
  methodName: string,
  paramsMetadata: ParamMetadata[],
): ((ctx: any) => unknown) | null {
  if (paramsMetadata.length === 0) {
    return () => instance[methodName]();
  }

  // Verify the params are positional (0..n-1) so we can pass them in order.
  for (let i = 0; i < paramsMetadata.length; i++) {
    if (paramsMetadata[i].index !== i) return null;
  }

  const method = instance[methodName] as (...args: any[]) => unknown;
  const call = method.bind(instance);

  // Build extractors for all params; bail if any is a custom param.
  const extractors: FastParamExtractor[] = [];
  for (let i = 0; i < paramsMetadata.length; i++) {
    const e = createExtractor(paramsMetadata[i], true);
    if (!e) return null; // custom param — fall back to slow path
    extractors.push(e);
  }

  const n = extractors.length;

  // Arity-1 special case: avoids array allocation entirely.
  if (n === 1) {
    const e0 = extractors[0];
    return (ctx) => call(e0(ctx));
  }

  // General case: loop-based extraction into a pre-sized array.
  return (ctx) => {
    // oxlint-disable-next-line no-new-array -- pre-sized for hot path
    const args = new Array(n);
    for (let i = 0; i < n; i++) args[i] = extractors[i](ctx);
    return call(...args);
  };
}

/**
 * Build a pre-compiled interceptor chain for a stable (static) list of
 * interceptors. The resulting function avoids per-request `CallHandler` object
 * allocations for the common case where the interceptor list never changes.
 */
function buildStaticInterceptorChain(
  interceptors: TechneInterceptor[],
): CompiledInterceptorChain {
  if (interceptors.length === 0) {
    return (_execCtx, handler) => handler();
  }

  if (interceptors.length === 1) {
    const only = interceptors[0];
    return (execCtx, handler) =>
      only.intercept(execCtx, { handle: () => Promise.resolve(handler()) });
  }

  // General case: capture references, build chain from inside out at call time.
  // Each call still allocates N CallHandler objects (same as the dynamic path),
  // but the interceptors array is captured rather than passed per-call.
  const chain = interceptors.slice();
  return (execCtx, handler) => {
    let next: CallHandler = { handle: async () => handler() };
    for (let i = chain.length - 1; i >= 0; i--) {
      const interceptor = chain[i];
      const currentNext = next;
      next = { handle: () => interceptor.intercept(execCtx, currentNext) };
    }
    return next.handle();
  };
}

export class RouterExecutionContext {
  private readonly handlerMetadataStorage = new HandlerMetadataStorage<CachedHandlerMetadata>();
  private readonly routeCaches: RouteRuntimeCache[] = [];
  private readonly executionContextHosts = new WeakMap<object, ExecutionContextHost>();
  private globalFilters: ExceptionFilter[] = [];
  private globalInterceptors: TechneInterceptor[] = [];
  private globalPipes: PipeTransform[] = [];
  private globalGuards: any[] = [];
  private routesRegistered = false;

  constructor(private readonly responseController: RouterResponseController) {}

  public setGlobalFilters(filters: ExceptionFilter[]) {
    this.globalFilters = filters;
    for (const cache of this.routeCaches) {
      this.refreshRouteCache(cache);
    }
  }

  public setGlobalInterceptors(interceptors: TechneInterceptor[]) {
    this.globalInterceptors = interceptors;
    for (const cache of this.routeCaches) {
      this.refreshRouteCache(cache);
    }
  }

  public setGlobalPipes(pipes: PipeTransform[]) {
    this.globalPipes = pipes;
    for (const cache of this.routeCaches) {
      this.refreshRouteCache(cache);
    }
  }

  /**
   * Register guards that apply to every route registered **after** this call.
   * Because guards are materialized as Elysia `beforeHandle` hooks at route
   * registration time, changing them after routes exist cannot retroactively
   * inject them. Callers should invoke this before `routesResolver.resolve()`
   * (either through `TechneApplicationOptions.globalGuards` or by calling
   * `app.useGlobalGuards()` before any route is registered).
   */
  public setGlobalGuards(guards: any[]): boolean {
    this.globalGuards = guards;
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
    const guardHooks = this.createGuardHooks(
      mergedGuards,
      container,
      controllerClass,
      handlerRef,
    );
    const beforeHandle =
      guardHooks.length === 0 && route.middlewares.length === 0
        ? undefined
        : [...guardHooks, ...route.middlewares];

    const cache: RouteRuntimeCache = {
      container,
      routeFilters: route.filters,
      routeInterceptors: route.interceptors,
      routePipes: route.pipes,
      staticFilters: [],
      contextualFilters: [],
      staticInterceptors: [],
      contextualInterceptors: [],
      staticPipes: [],
      contextualPipes: [],
      hasRuntimeEnhancers: false,
      hasGuards: mergedGuards.length > 0,
      hasFilters: false,
      hasInterceptors: false,
      hasPipes: false,
      hasRequestScopedDeps: false,
      controllerClass,
      guards: mergedGuards,
    };
    if (route.schema && (route.schema as any).response) {
      try {
        cache.responseStringifier = compileStringifier((route.schema as any).response);
      } catch {
        cache.responseStringifier = undefined;
      }
    }
    this.refreshRouteCache(cache);
    this.routeCaches.push(cache);

    const handler = this.compileHandler(
      route,
      metadata,
      cache,
      controllerClass,
      handlerRef,
      container,
    );

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
    const responseController = this.responseController;
    const handlerName = route.handlerName;
    const paramsMetadata = route.paramsMetadata;
    const bindArgs = metadata.bindArgs;
    const hasCustomParam = metadata.hasCustomParam;
    const applyPipes = this.applyPipes;
    const applyInterceptors = this.applyInterceptors;

    const slow = (context: RequestHandlerContext) => {
      // Cost-tagged fast slow-path: skip request-scoped DI bookkeeping when
      // nothing on the route (controller, guards, filters, interceptors,
      // pipes) is contextual.
      if (!cache.hasRequestScopedDeps) {
        return this.runWithoutResolutionContext(
          context,
          cache,
          controllerClass,
          handlerName,
          handlerRef,
          paramsMetadata,
          bindArgs,
          hasCustomParam,
          container,
          applyPipes,
        );
      }

      const requestKey = this.getRequestContextKey(context);
      const contextId = ContextIdFactory.getByRequest(requestKey);
      const resolutionContext = { request: context, contextId };
      const controllerInstance = this.resolveInstance<any>(
        controllerClass,
        container,
        resolutionContext,
      );
      const mergedFilters = this.resolveRouteInstances<ExceptionFilter>(
        cache.staticFilters,
        cache.contextualFilters,
        container,
        resolutionContext,
      );
      const mergedInterceptors = this.resolveRouteInstances<TechneInterceptor>(
        cache.staticInterceptors,
        cache.contextualInterceptors,
        container,
        resolutionContext,
      );
      const mergedPipes = this.resolveRouteInstances<PipeTransform>(
        cache.staticPipes,
        cache.contextualPipes,
        container,
        resolutionContext,
      );

      let executionContext: ExecutionContextHost | undefined = hasCustomParam
        ? this.getOrCreateExecutionContext(context, controllerClass, handlerRef)
        : undefined;
      const getExecutionContext = () => {
        if (!executionContext) {
          executionContext = this.getOrCreateExecutionContext(context, controllerClass, handlerRef);
        }
        return executionContext;
      };

      const handleException = (error: unknown) => {
        for (let i = mergedFilters.length - 1; i >= 0; i--) {
          const filter = mergedFilters[i];
          if (!filterShouldCatch(filter, error)) continue;
          try {
            return filter.catch(error, getExecutionContext());
          } catch {
            // Filter didn't handle it, try next
          }
        }
        return responseController.mapException(context, error);
      };

      try {
        const args = bindArgs(context, executionContext);

        if (mergedPipes.length > 0) {
          applyPipes(args, paramsMetadata, mergedPipes);
        }

        if (mergedInterceptors.length > 0) {
          const callHandler = () => controllerInstance[handlerName](...args);
          const result = applyInterceptors(getExecutionContext(), mergedInterceptors, callHandler);
          if (isPromiseLike(result)) {
            return (result as Promise<unknown>).then(
              (r) => this.maybeStringify(context, cache, r),
              handleException,
            );
          }
          return this.maybeStringify(context, cache, result);
        }

        const result = controllerInstance[handlerName](...args);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(
            (r) => this.maybeStringify(context, cache, r),
            handleException,
          );
        }
        return this.maybeStringify(context, cache, result);
      } catch (error) {
        return handleException(error);
      } finally {
        container.clearContext(contextId);
        ContextIdFactory.clear(requestKey);
        this.executionContextHosts.delete(requestKey);
      }
    };

    // Fast path: routes with no pipes, interceptors, or filters (and an empty
    // global state at compile time) account for the vast majority of
    // endpoints. Specialize on arity to avoid the per-request args array,
    // spread, and length checks. The slow path is used as soon as a global is
    // installed via useGlobalPipes/Filters/Interceptors after registration.
    if (!cache.hasRuntimeEnhancers) {
      const fastController = container.isStatic(controllerClass)
        ? container.get<any>(controllerClass)
        : undefined;
      const fast = fastController
        ? compileFastHandler(fastController, handlerName, paramsMetadata)
        : null;
      if (fast && fastController) {
        return (context: RequestHandlerContext) => {
          // Re-check on every call so a global installed at runtime takes
          // effect. The check is a cached route-state flag.
          if (cache.hasRuntimeEnhancers) {
            return slow(context);
          }
          try {
            const result = fast(context);
            if (isPromiseLike(result)) {
              return (result as Promise<unknown>).then(
                (r) => this.maybeStringify(context, cache, r),
                (err) => responseController.mapException(context, err),
              );
            }
            return this.maybeStringify(context, cache, result);
          } catch (error) {
            return responseController.mapException(context, error);
          }
        };
      }
    }

    return slow;
  }

  /**
   * Cost-tagged slow path: when no enhancer (filter/interceptor/pipe) or
   * dependency on the route is request-scoped, we skip ContextIdFactory,
   * resolutionContext bookkeeping, and execution-context-host management
   * entirely. Static guards have already been resolved at boot.
   */
  private runWithoutResolutionContext(
    context: RequestHandlerContext,
    cache: RouteRuntimeCache,
    controllerClass: any,
    handlerName: string,
    handlerRef: Function,
    paramsMetadata: ParamMetadata[],
    bindArgs: CompiledArgsBinder,
    hasCustomParam: boolean,
    container: ContainerLike,
    applyPipes: (args: any[], paramsMetadata: ParamMetadata[], pipes: PipeTransform[]) => void,
  ): unknown {
    const responseController = this.responseController;
    const controllerInstance = container.get<any>(controllerClass);
    const mergedFilters = cache.staticFilters;
    const mergedInterceptors = cache.staticInterceptors;
    const mergedPipes = cache.staticPipes;

    let executionContext: ExecutionContextHost | undefined = hasCustomParam
      ? this.getOrCreateExecutionContext(context, controllerClass, handlerRef)
      : undefined;
    const getExecutionContext = () => {
      if (!executionContext) {
        executionContext = this.getOrCreateExecutionContext(context, controllerClass, handlerRef);
      }
      return executionContext;
    };

    const handleException = (error: unknown): unknown => {
      for (let i = mergedFilters.length - 1; i >= 0; i--) {
        const filter = mergedFilters[i];
        if (!filterShouldCatch(filter, error)) continue;
        try {
          return filter.catch(error, getExecutionContext());
        } catch {
          // Filter didn't handle it, try next
        }
      }
      return responseController.mapException(context, error);
    };

    try {
      const args = bindArgs(context, executionContext);
      if (mergedPipes.length > 0) {
        applyPipes(args, paramsMetadata, mergedPipes);
      }

      if (mergedInterceptors.length > 0) {
        const callHandler = () => controllerInstance[handlerName](...args);
        const result = cache.compiledStaticInterceptorChain!(getExecutionContext(), callHandler);
        if (isPromiseLike(result)) {
          return (result as Promise<unknown>).then(
            (r) => this.maybeStringify(context, cache, r),
            handleException,
          );
        }
        return this.maybeStringify(context, cache, result);
      }

      const result = controllerInstance[handlerName](...args);
      if (isPromiseLike(result)) {
        return (result as Promise<unknown>).then(
          (r) => this.maybeStringify(context, cache, r),
          handleException,
        );
      }
      return this.maybeStringify(context, cache, result);
    } catch (error) {
      return handleException(error);
    } finally {
      if (executionContext) {
        // Only created if hasCustomParam was true — clean up.
        this.executionContextHosts.delete(this.getRequestContextKey(context));
      }
    }
  }

  /**
   * Apply the precompiled response stringifier if one exists, otherwise
   * return the result unmodified.
   *
   * Perf note: the common `status=200` path reuses the module-level frozen
   * `RESPONSE_INIT_OK` so we don't allocate a fresh `Headers` / init object
   * per request. Only when the handler set a non-200 status do we allocate
   * a per-call init (still reusing the shared headers object).
   */
  private maybeStringify(
    context: RequestHandlerContext,
    cache: RouteRuntimeCache,
    result: unknown,
  ): unknown {
    const stringifier = cache.responseStringifier;
    if (!stringifier) return result;
    if (result === undefined || result === null) return result;
    if (result instanceof Response) return result;
    const t = typeof result;
    if (t !== "object") return result; // string / number / boolean — Elysia handles
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
      // Fallback: let Elysia serialize on its own.
      return result;
    }
  }

  private refreshRouteCache(cache: RouteRuntimeCache): void {
    const filters = this.partitionRouteInstances<ExceptionFilter>(
      mergeArrays(this.globalFilters, cache.routeFilters),
      cache.container,
    );
    cache.staticFilters = filters.staticInstances;
    cache.contextualFilters = filters.contextualTokens;

    const interceptors = this.partitionRouteInstances<TechneInterceptor>(
      mergeArrays(this.globalInterceptors, cache.routeInterceptors),
      cache.container,
    );
    cache.staticInterceptors = interceptors.staticInstances;
    cache.contextualInterceptors = interceptors.contextualTokens;

    const pipes = this.partitionRouteInstances<PipeTransform>(
      mergeArrays(this.globalPipes, cache.routePipes),
      cache.container,
    );
    cache.staticPipes = pipes.staticInstances;
    cache.contextualPipes = pipes.contextualTokens;
    cache.hasFilters = cache.staticFilters.length > 0 || cache.contextualFilters.length > 0;
    cache.hasInterceptors =
      cache.staticInterceptors.length > 0 || cache.contextualInterceptors.length > 0;
    cache.hasPipes = cache.staticPipes.length > 0 || cache.contextualPipes.length > 0;
    cache.hasRuntimeEnhancers = cache.hasFilters || cache.hasInterceptors || cache.hasPipes;

    // Pre-compile the static interceptor chain so per-request calls don't need
    // to pass the interceptors array (avoids closure capture on hot path).
    cache.compiledStaticInterceptorChain = buildStaticInterceptorChain(cache.staticInterceptors);

    // Cost tag: does this route need request-scoped DI bookkeeping?
    cache.hasRequestScopedDeps = this.computeHasRequestScopedDeps(cache);
  }

  private computeHasRequestScopedDeps(cache: RouteRuntimeCache): boolean {
    const container = cache.container;
    const isContextual = (token: any): boolean => {
      if (typeof token !== "function") return false;
      if (container.hasContextualDeps) return container.hasContextualDeps(token);
      // Fall back to isStatic — anything not static is contextual.
      return !container.isStatic(token);
    };

    if (cache.controllerClass && isContextual(cache.controllerClass)) return true;
    for (const g of cache.guards) {
      if (isContextual(g)) return true;
    }
    for (const f of cache.contextualFilters) {
      if (isContextual(f)) return true;
    }
    for (const f of cache.routeFilters) {
      if (isContextual(f)) return true;
    }
    for (const i of cache.contextualInterceptors) {
      if (isContextual(i)) return true;
    }
    for (const i of cache.routeInterceptors) {
      if (isContextual(i)) return true;
    }
    for (const p of cache.contextualPipes) {
      if (isContextual(p)) return true;
    }
    for (const p of cache.routePipes) {
      if (isContextual(p)) return true;
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
    context?: { request?: any; contextId?: symbol; inquirer?: any },
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
    context?: { request?: any; contextId?: symbol; inquirer?: any },
  ): T[] {
    return classes.map((cls) => {
      // If it's already an instance (not a class), use it directly
      if (typeof cls !== "function") return cls as T;
      try {
        return context ? container.resolve<T>(cls, context) : container.get<T>(cls);
      } catch {
        // If not in container, instantiate directly
        return new cls() as T;
      }
    });
  }

  private resolveInstance<T>(
    token: any,
    container: ContainerLike,
    context: { request?: any; contextId?: symbol; inquirer?: any },
  ): T {
    return container.isStatic(token)
      ? container.get<T>(token)
      : container.resolve<T>(token, context);
  }

  private applyPipes(args: any[], paramsMetadata: ParamMetadata[], pipes: PipeTransform[]): void {
    for (const param of paramsMetadata) {
      if (param.type === "request") continue; // Don't pipe raw request
      const metadata: ArgumentMetadata = {
        type: param.type as any,
        name: param.name,
        metatype: param.dtoClass ?? param.metatype,
      };
      let value = args[param.index];
      for (const pipe of pipes) {
        value = pipe.transform(value, metadata);
      }
      args[param.index] = value;
    }
  }

  private applyInterceptors(
    context: RequestHandlerContext,
    interceptors: TechneInterceptor[],
    handler: () => any,
  ): any {
    // Build the interceptor chain from inside out
    let next: CallHandler = {
      handle: async () => handler(),
    };

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const currentNext = next;
      next = {
        handle: () => interceptor.intercept(context, currentNext),
      };
    }

    return next.handle();
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

    // Specialize for the common single-param case: avoid the per-request switch
    // and lift the property lookup into the boot-time closure.
    if (methodParams.length === 1 && length === 1) {
      const extract = createExtractor(methodParams[0], false);
      return (context, execCtx) => [extract(context, execCtx)];
    }

    const extractors: ParamExtractor[] = [];
    const indexes: number[] = [];
    for (const param of methodParams) {
      extractors.push(createExtractor(param, false));
      indexes.push(param.index);
    }
    const arity = extractors.length;

    return (context, execCtx) => {
      // oxlint-disable-next-line no-new-array -- pre-sized for hot path
      const args = new Array(length);
      for (let i = 0; i < arity; i++) {
        args[indexes[i]] = extractors[i](context, execCtx);
      }
      return args;
    };
  }

  private createGuardHooks(
    guards: any[],
    container: ContainerLike,
    controllerClass: any,
    handlerRef: Function,
  ) {
    return guards.map((guardClass: any) => {
      // Static-guard hoisting: when the guard's DI tree has no request-scoped
      // deps, resolve it once at boot and capture the instance in the
      // closure. The per-request hook then skips ContextIdFactory entirely.
      const isClassToken = typeof guardClass === "function";
      const isStaticGuard =
        !isClassToken ||
        (container.isStatic(guardClass) &&
          (!container.hasContextualDeps || !container.hasContextualDeps(guardClass)));

      if (isStaticGuard) {
        const guardInstance = isClassToken ? container.get<any>(guardClass) : guardClass;

        return (context: RequestHandlerContext) => {
          const executionContext = this.getOrCreateExecutionContext(
            context,
            controllerClass,
            handlerRef,
          );
          try {
            const result = guardInstance.canActivate(executionContext);

            if (isPromiseLike<boolean>(result)) {
              return result
                .then((canActivate) => {
                  if (!canActivate) {
                    return this.responseController.mapException(context, new ForbiddenException());
                  }
                })
                .catch((error: unknown) => this.responseController.mapException(context, error));
            }

            if (!result) {
              return this.responseController.mapException(context, new ForbiddenException());
            }
          } catch (error) {
            return this.responseController.mapException(context, error);
          }
        };
      }

      // Contextual guard: must resolve per-request.
      return (context: RequestHandlerContext) => {
        const requestKey = this.getRequestContextKey(context);
        const contextId = ContextIdFactory.getByRequest(requestKey);
        const guardInstance = this.resolveInstance<any>(guardClass, container, {
          request: context,
          contextId,
        });
        const executionContext = this.getOrCreateExecutionContext(
          context,
          controllerClass,
          handlerRef,
        );
        try {
          const result = guardInstance.canActivate(executionContext);

          if (isPromiseLike<boolean>(result)) {
            return result
              .then((canActivate) => {
                if (!canActivate) {
                  container.clearContext(contextId);
                  ContextIdFactory.clear(requestKey);
                  this.executionContextHosts.delete(requestKey);
                  return this.responseController.mapException(context, new ForbiddenException());
                }
              })
              .catch((error: unknown) => {
                container.clearContext(contextId);
                ContextIdFactory.clear(requestKey);
                this.executionContextHosts.delete(requestKey);
                return this.responseController.mapException(context, error);
              });
          }

          if (!result) {
            container.clearContext(contextId);
            ContextIdFactory.clear(requestKey);
            this.executionContextHosts.delete(requestKey);
            return this.responseController.mapException(context, new ForbiddenException());
          }
        } catch (error) {
          container.clearContext(contextId);
          ContextIdFactory.clear(requestKey);
          this.executionContextHosts.delete(requestKey);
          return this.responseController.mapException(context, error);
        }
      };
    });
  }

  private getOrCreateExecutionContext(
    context: RequestHandlerContext,
    controllerClass: any,
    handlerRef: Function,
  ): ExecutionContextHost {
    const requestKey = this.getRequestContextKey(context);
    const existing = this.executionContextHosts.get(requestKey);
    if (existing) {
      return existing;
    }

    const created = new ExecutionContextHost(context, controllerClass, handlerRef);
    this.executionContextHosts.set(requestKey, created);
    return created;
  }

  private getRequestContextKey(context: RequestHandlerContext): object {
    return (context?.request as object | undefined) ?? context;
  }
}
