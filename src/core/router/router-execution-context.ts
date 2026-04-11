import { ForbiddenException } from "../../exceptions";
import { CATCH_METADATA } from "../../common/constants";
import type { ParamMetadata } from "../../decorators/params.decorator";
import type { ExceptionFilter } from "../../interfaces/exception-filter.interface";
import type { BnestInterceptor, CallHandler } from "../../interfaces/interceptor.interface";
import type { PipeTransform, ArgumentMetadata } from "../../interfaces/pipe-transform.interface";
import { ExecutionContextHost } from "../execution-context";
import { HandlerMetadataStorage } from "./handler-metadata-storage";
import { RouterResponseController } from "./router-response-controller";
import type { DiscoveredRouteDefinition } from "./router-explorer";

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

interface RouteRuntimeCache {
  routeFilters: ExceptionFilter[];
  routeInterceptors: BnestInterceptor[];
  routePipes: PipeTransform[];
  mergedFilters: ExceptionFilter[];
  mergedInterceptors: BnestInterceptor[];
  mergedPipes: PipeTransform[];
}

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);

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

function createParamExtractor(param: ParamMetadata): ParamExtractor {
  const name = param.name;
  switch (param.type) {
    case "body":
      return name ? (ctx) => ctx.body?.[name] : (ctx) => ctx.body;
    case "param":
      return name ? (ctx) => ctx.params?.[name] : (ctx) => ctx.params;
    case "query":
      return name ? (ctx) => ctx.query?.[name] : (ctx) => ctx.query;
    case "headers":
      return name ? (ctx) => ctx.headers?.[name] : (ctx) => ctx.headers;
    case "request":
      return (ctx) => ctx.request;
    case "custom": {
      const factory = param.factory;
      const data = param.data;
      if (!factory) return () => undefined;
      return (_ctx, execCtx) => factory(data, execCtx as any);
    }
    default:
      return () => undefined;
  }
}

/**
 * Compile a directly-callable handler for routes with arity ≤ 3, sorted by
 * positional index. Returns `null` for shapes we don't specialize so the
 * caller can fall back to the generic args-array path.
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
    if (paramsMetadata[i].type === "custom") return null;
  }

  if (paramsMetadata.length === 1) {
    const e0 = createParamExtractor(paramsMetadata[0]);
    return (ctx) => instance[methodName](e0(ctx, undefined));
  }
  if (paramsMetadata.length === 2) {
    const e0 = createParamExtractor(paramsMetadata[0]);
    const e1 = createParamExtractor(paramsMetadata[1]);
    return (ctx) => instance[methodName](e0(ctx, undefined), e1(ctx, undefined));
  }
  if (paramsMetadata.length === 3) {
    const e0 = createParamExtractor(paramsMetadata[0]);
    const e1 = createParamExtractor(paramsMetadata[1]);
    const e2 = createParamExtractor(paramsMetadata[2]);
    return (ctx) =>
      instance[methodName](e0(ctx, undefined), e1(ctx, undefined), e2(ctx, undefined));
  }
  return null;
}

export class RouterExecutionContext {
  private readonly handlerMetadataStorage = new HandlerMetadataStorage<CachedHandlerMetadata>();
  private readonly routeCaches: RouteRuntimeCache[] = [];
  private globalFilters: ExceptionFilter[] = [];
  private globalInterceptors: BnestInterceptor[] = [];
  private globalPipes: PipeTransform[] = [];
  private globalGuards: any[] = [];
  private routesRegistered = false;

  constructor(private readonly responseController: RouterResponseController) {}

  public setGlobalFilters(filters: ExceptionFilter[]) {
    this.globalFilters = filters;
    for (const cache of this.routeCaches) {
      cache.mergedFilters = mergeArrays(filters, cache.routeFilters);
    }
  }

  public setGlobalInterceptors(interceptors: BnestInterceptor[]) {
    this.globalInterceptors = interceptors;
    for (const cache of this.routeCaches) {
      cache.mergedInterceptors = mergeArrays(interceptors, cache.routeInterceptors);
    }
  }

  public setGlobalPipes(pipes: PipeTransform[]) {
    this.globalPipes = pipes;
    for (const cache of this.routeCaches) {
      cache.mergedPipes = mergeArrays(pipes, cache.routePipes);
    }
  }

  /**
   * Register guards that apply to every route registered **after** this call.
   * Because guards are materialized as Elysia `beforeHandle` hooks at route
   * registration time, changing them after routes exist cannot retroactively
   * inject them. Callers should invoke this before `routesResolver.resolve()`
   * (either through `BnestApplicationOptions.globalGuards` or by calling
   * `app.useGlobalGuards()` before any route is registered).
   */
  public setGlobalGuards(guards: any[]): boolean {
    this.globalGuards = guards;
    return !this.routesRegistered;
  }

  public getGlobalGuards(): any[] {
    return this.globalGuards;
  }

  public create(route: DiscoveredRouteDefinition, container: { get<T>(token: any): T }) {
    this.routesRegistered = true;
    const metadata = this.getMetadata(route);
    const controllerClass = route.controller;
    const handlerRef = route.controllerInstance[route.handlerName] as Function;
    const mergedGuards =
      this.globalGuards.length === 0 ? route.guards : [...this.globalGuards, ...route.guards];
    const guardHooks = this.createGuardHooks(mergedGuards, container, controllerClass, handlerRef);
    const beforeHandle =
      guardHooks.length === 0 && route.middlewares.length === 0
        ? undefined
        : [...guardHooks, ...route.middlewares];

    const routeFilters = this.resolveInstances<ExceptionFilter>(route.filters, container);
    const routeInterceptors = this.resolveInstances<BnestInterceptor>(
      route.interceptors,
      container,
    );
    const routePipes = this.resolveInstances<PipeTransform>(route.pipes, container);

    const cache: RouteRuntimeCache = {
      routeFilters,
      routeInterceptors,
      routePipes,
      mergedFilters: mergeArrays(this.globalFilters, routeFilters),
      mergedInterceptors: mergeArrays(this.globalInterceptors, routeInterceptors),
      mergedPipes: mergeArrays(this.globalPipes, routePipes),
    };
    this.routeCaches.push(cache);

    const handler = this.compileHandler(route, metadata, cache, controllerClass, handlerRef);

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
  ): (context: RequestHandlerContext) => unknown {
    const responseController = this.responseController;
    const controllerInstance = route.controllerInstance;
    const handlerName = route.handlerName;
    const paramsMetadata = route.paramsMetadata;
    const bindArgs = metadata.bindArgs;
    const hasCustomParam = metadata.hasCustomParam;
    const applyPipes = this.applyPipes;
    const applyInterceptors = this.applyInterceptors;

    const slow = (context: RequestHandlerContext) => {
      const mergedFilters = cache.mergedFilters;
      const mergedInterceptors = cache.mergedInterceptors;
      const mergedPipes = cache.mergedPipes;

      // Allocate an ExecutionContextHost lazily — only if we actually have
      // an interceptor or filter that might read from it, a guard wired
      // into beforeHandle needs one elsewhere, or a custom param decorator
      // requires it for bindArgs.
      let executionContext: ExecutionContextHost | undefined = hasCustomParam
        ? new ExecutionContextHost(context, controllerClass, handlerRef)
        : undefined;
      const getExecutionContext = () => {
        if (!executionContext) {
          executionContext = new ExecutionContextHost(context, controllerClass, handlerRef);
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
          return isPromiseLike(result) ? result.catch(handleException) : result;
        }

        const result = controllerInstance[handlerName](...args);
        return isPromiseLike(result) ? result.catch(handleException) : result;
      } catch (error) {
        return handleException(error);
      }
    };

    // Fast path: routes with no pipes, interceptors, or filters (and an empty
    // global state at compile time) account for the vast majority of
    // endpoints. Specialize on arity to avoid the per-request args array,
    // spread, and length checks. The slow path is used as soon as a global is
    // installed via useGlobalPipes/Filters/Interceptors after registration.
    if (
      cache.mergedPipes.length === 0 &&
      cache.mergedInterceptors.length === 0 &&
      cache.mergedFilters.length === 0 &&
      this.globalPipes.length === 0 &&
      this.globalInterceptors.length === 0 &&
      this.globalFilters.length === 0
    ) {
      const fast = compileFastHandler(controllerInstance, handlerName, paramsMetadata);
      if (fast) {
        return (context: RequestHandlerContext) => {
          // Re-check on every call so a global installed at runtime takes
          // effect. The check is just three length lookups.
          if (
            cache.mergedPipes.length > 0 ||
            cache.mergedInterceptors.length > 0 ||
            cache.mergedFilters.length > 0
          ) {
            return slow(context);
          }
          try {
            const result = fast(context);
            return isPromiseLike(result)
              ? result.catch((err) => responseController.mapException(context, err))
              : result;
          } catch (error) {
            return responseController.mapException(context, error);
          }
        };
      }
    }

    return slow;
  }

  private resolveInstances<T>(classes: any[], container: { get<T>(token: any): T }): T[] {
    return classes.map((cls) => {
      // If it's already an instance (not a class), use it directly
      if (typeof cls !== "function") return cls as T;
      try {
        return container.get<T>(cls);
      } catch {
        // If not in container, instantiate directly
        return new cls() as T;
      }
    });
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
    interceptors: BnestInterceptor[],
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
      const extract = createParamExtractor(methodParams[0]);
      return (context, execCtx) => [extract(context, execCtx)];
    }

    const extractors: ParamExtractor[] = [];
    const indexes: number[] = [];
    for (const param of methodParams) {
      extractors.push(createParamExtractor(param));
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
    container: { get<T>(token: any): T },
    controllerClass: any,
    handlerRef: Function,
  ) {
    return guards.map((guardClass: any) => {
      const guardInstance =
        typeof guardClass === "function" ? container.get<any>(guardClass) : guardClass;

      return (context: RequestHandlerContext) => {
        const executionContext = new ExecutionContextHost(context, controllerClass, handlerRef);
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
    });
  }
}
