import { ForbiddenException } from "../../exceptions";
import type { ParamMetadata } from "../../decorators/params.decorator";
import type { ExceptionFilter } from "../../interfaces/exception-filter.interface";
import type { BnestInterceptor, CallHandler } from "../../interfaces/interceptor.interface";
import type { PipeTransform, ArgumentMetadata } from "../../interfaces/pipe-transform.interface";
import { HandlerMetadataStorage } from "./handler-metadata-storage";
import { RouterResponseController } from "./router-response-controller";
import type { DiscoveredRouteDefinition } from "./router-explorer";

type RequestHandlerContext = any;
type CompiledArgsBinder = (context: RequestHandlerContext) => any[];

export interface CompiledRouteDefinition {
  method: DiscoveredRouteDefinition["method"];
  fullPath: string;
  schema?: DiscoveredRouteDefinition["schema"];
  beforeHandle?: any[];
  handler: (context: RequestHandlerContext) => unknown;
}

interface CachedHandlerMetadata {
  bindArgs: CompiledArgsBinder;
}

function isPromiseLike<T = unknown>(value: unknown): value is Promise<T> {
  return !!value && (typeof value === "object" || typeof value === "function") && "then" in value;
}

export class RouterExecutionContext {
  private readonly handlerMetadataStorage = new HandlerMetadataStorage<CachedHandlerMetadata>();
  private globalFilters: ExceptionFilter[] = [];
  private globalInterceptors: BnestInterceptor[] = [];
  private globalPipes: PipeTransform[] = [];

  constructor(private readonly responseController: RouterResponseController) {}

  public setGlobalFilters(filters: ExceptionFilter[]) {
    this.globalFilters = filters;
  }

  public setGlobalInterceptors(interceptors: BnestInterceptor[]) {
    this.globalInterceptors = interceptors;
  }

  public setGlobalPipes(pipes: PipeTransform[]) {
    this.globalPipes = pipes;
  }

  public create(route: DiscoveredRouteDefinition, container: { get<T>(token: any): T }) {
    const metadata = this.getMetadata(route);
    const guardHooks = this.createGuardHooks(route.guards, container);
    const beforeHandle = [...guardHooks, ...route.middlewares];

    // Resolve filter instances
    const filters = this.resolveInstances<ExceptionFilter>(route.filters, container);
    const allFilters = [...this.globalFilters, ...filters];

    // Resolve interceptor instances
    const interceptors = this.resolveInstances<BnestInterceptor>(route.interceptors, container);
    const allInterceptors = [...this.globalInterceptors, ...interceptors];

    // Resolve pipe instances
    const pipes = this.resolveInstances<PipeTransform>(route.pipes, container);
    const allPipes = [...this.globalPipes, ...pipes];

    const handler = (context: RequestHandlerContext) => {
      const handleException = (error: unknown) => {
        // Try exception filters first (route-specific take priority)
        for (let i = allFilters.length - 1; i >= 0; i--) {
          try {
            const result = allFilters[i].catch(error, context);
            return result;
          } catch {
            // Filter didn't handle it, try next
          }
        }
        // Fall back to default exception mapping
        return this.responseController.mapException(context, error);
      };

      try {
        let args = metadata.bindArgs(context);

        // Apply pipes to args
        if (allPipes.length > 0) {
          args = this.applyPipes(args, route.paramsMetadata, allPipes);
        }

        // Build the handler execution chain through interceptors
        const callHandler = () => route.controllerInstance[route.handlerName](...args);

        if (allInterceptors.length > 0) {
          const result = this.applyInterceptors(context, allInterceptors, callHandler);
          return isPromiseLike(result) ? result.catch(handleException) : result;
        }

        const result = callHandler();
        return isPromiseLike(result) ? result.catch(handleException) : result;
      } catch (error) {
        return handleException(error);
      }
    };

    return {
      method: route.method,
      fullPath: route.fullPath,
      schema: route.schema,
      beforeHandle: beforeHandle.length > 0 ? beforeHandle : undefined,
      handler,
    } satisfies CompiledRouteDefinition;
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

  private applyPipes(args: any[], paramsMetadata: ParamMetadata[], pipes: PipeTransform[]): any[] {
    const result = [...args];
    for (const param of paramsMetadata) {
      if (param.type === "request") continue; // Don't pipe raw request
      const metadata: ArgumentMetadata = { type: param.type as any, name: param.name };
      let value = result[param.index];
      for (const pipe of pipes) {
        value = pipe.transform(value, metadata);
      }
      result[param.index] = value;
    }
    return result;
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
    };
    this.handlerMetadataStorage.set(route.controller, route.handlerName, metadata);
    return metadata;
  }

  private createArgsBinder(methodParams: ParamMetadata[]): CompiledArgsBinder {
    if (methodParams.length === 0) {
      return () => [];
    }

    const maxIndex = Math.max(...methodParams.map((param) => param.index));

    return (context: RequestHandlerContext) => {
      const args = Array.from({ length: maxIndex + 1 });

      for (const param of methodParams) {
        switch (param.type) {
          case "body":
            args[param.index] = param.name ? context.body?.[param.name] : context.body;
            break;
          case "param":
            args[param.index] = param.name ? context.params?.[param.name] : context.params;
            break;
          case "query":
            args[param.index] = param.name ? context.query?.[param.name] : context.query;
            break;
          case "headers":
            args[param.index] = param.name ? context.headers?.[param.name] : context.headers;
            break;
          case "request":
            args[param.index] = context.request;
            break;
        }
      }

      return args;
    };
  }

  private createGuardHooks(guards: any[], container: { get<T>(token: any): T }) {
    return guards.map((guardClass: any) => {
      const guardInstance = container.get<any>(guardClass);

      return (context: RequestHandlerContext) => {
        try {
          const result = guardInstance.canActivate(context);

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
