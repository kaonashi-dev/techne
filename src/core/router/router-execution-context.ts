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
  private routesRegistered = false;
  private validateResponses = false;

  constructor(private readonly responseController: RouterResponseController) {}

  public setValidateResponses(value: boolean): void {
    this.validateResponses = value;
  }

  public setGlobalFilters(filters: ExceptionFilter[]) {
    this.globalFilters = filters;
    for (const cache of this.routeCaches) {
      this.refreshRouteCache(cache);
      cache.recompile?.();
    }
  }

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
    const guardHooks = this.createGuardHooks(mergedGuards, container, controllerClass, handlerRef);
    const beforeHandle =
      guardHooks.length === 0 && route.middlewares.length === 0
        ? undefined
        : [...guardHooks, ...route.middlewares];

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
      const fast = fastController
        ? compileFastHandler(fastController, handlerName, paramsMetadata)
        : null;
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
    const filters = this.partitionRouteInstances<ExceptionFilter>(
      mergeArrays(this.globalFilters, cache.routeFilters),
      cache.container,
    );
    cache.staticFilters = filters.staticInstances;
    cache.contextualFilters = filters.contextualTokens;

    const responseHooks = this.partitionRouteInstances<ResponseHook>(
      cache.routeResponseHooks,
      cache.container,
    );
    cache.staticResponseHooks = responseHooks.staticInstances;
    cache.contextualResponseHooks = responseHooks.contextualTokens;

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

  private createGuardHooks(
    guards: any[],
    container: ContainerLike,
    controllerClass: any,
    handlerRef: Function,
  ) {
    return guards.map((guardClass: any) => {
      const isClassToken = typeof guardClass === "function";
      const isStaticGuard =
        !isClassToken ||
        (container.isStatic(guardClass) &&
          (!container.hasContextualDeps || !container.hasContextualDeps(guardClass)));

      if (isStaticGuard) {
        const guardInstance = isClassToken ? container.get<any>(guardClass) : guardClass;

        return (context: RequestHandlerContext) => {
          const routeContext: RouteContextInfo = {
            ctx: context,
            controller: controllerClass,
            handler: handlerRef,
          };
          try {
            const result = guardInstance.canActivate(routeContext as any);

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

      return (context: RequestHandlerContext) => {
        const guardInstance = this.resolveInstance<any>(guardClass, container, {
          request: context,
        });
        const routeContext: RouteContextInfo = {
          ctx: context,
          controller: controllerClass,
          handler: handlerRef,
        };
        try {
          const result = guardInstance.canActivate(routeContext as any);

          if (isPromiseLike<boolean>(result)) {
            return result
              .then((canActivate) => {
                if (!canActivate) {
                  container.clearContext(context);
                  return this.responseController.mapException(context, new ForbiddenException());
                }
              })
              .catch((error: unknown) => {
                container.clearContext(context);
                return this.responseController.mapException(context, error);
              });
          }

          if (!result) {
            container.clearContext(context);
            return this.responseController.mapException(context, new ForbiddenException());
          }
        } catch (error) {
          container.clearContext(context);
          return this.responseController.mapException(context, error);
        }
      };
    });
  }
}
