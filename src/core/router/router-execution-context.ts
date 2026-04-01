import { ForbiddenException } from "../../exceptions";
import type { ParamMetadata } from "../../decorators/params.decorator";
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

  constructor(private readonly responseController: RouterResponseController) {}

  public create(route: DiscoveredRouteDefinition, container: { get<T>(token: any): T }) {
    const metadata = this.getMetadata(route);
    const guardHooks = this.createGuardHooks(route.guards, container);
    const beforeHandle = [...guardHooks, ...route.middlewares];

    const handler = (context: RequestHandlerContext) => {
      const args = metadata.bindArgs(context);

      try {
        const result = route.controllerInstance[route.handlerName](...args);
        return isPromiseLike(result)
          ? result.catch((error: unknown) => this.responseController.mapException(context, error))
          : result;
      } catch (error) {
        return this.responseController.mapException(context, error);
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
