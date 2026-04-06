import {
  CONTROLLER_METADATA,
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  MIDDLEWARE_METADATA,
  PARAMS_METADATA,
  PIPES_METADATA,
  ROUTES_METADATA,
} from "../../common/constants";
import type { ParamMetadata } from "../../decorators/params.decorator";
import type { RouteMetadata } from "../../decorators/routes.decorator";
import { getDtoSchema } from "../../schema/dto";
import type { Scanner } from "../scanner";

export interface DiscoveredRouteDefinition extends RouteMetadata {
  controller: any;
  controllerInstance: any;
  fullPath: string;
  middlewares: any[];
  guards: any[];
  filters: any[];
  interceptors: any[];
  pipes: any[];
  paramsMetadata: ParamMetadata[];
}

export class RouterExplorer {
  constructor(private readonly scanner: Scanner) {}

  public explore(): DiscoveredRouteDefinition[] {
    const routes: DiscoveredRouteDefinition[] = [];
    const container = this.scanner.getContainer();

    for (const controller of this.scanner.getControllers()) {
      const controllerInstance = container.get(controller);
      const prefix = (Reflect.getMetadata(CONTROLLER_METADATA, controller) as string) || "";
      const routeMetadata: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA, controller) || [];
      const controllerMiddlewares: any[] =
        Reflect.getMetadata(MIDDLEWARE_METADATA, controller) || [];
      const controllerGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
      const controllerFilters: any[] =
        Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, controller) || [];
      const controllerInterceptors: any[] =
        Reflect.getMetadata(INTERCEPTORS_METADATA, controller) || [];
      const controllerPipes: any[] = Reflect.getMetadata(PIPES_METADATA, controller) || [];
      const paramsByHandler: Record<string, ParamMetadata[]> =
        Reflect.getMetadata(PARAMS_METADATA, controller) || {};

      for (const route of routeMetadata) {
        const routeHandler = controller.prototype[route.handlerName];
        const routeMiddlewares: any[] =
          Reflect.getMetadata(MIDDLEWARE_METADATA, routeHandler) || [];
        const routeGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, routeHandler) || [];
        const routeFilters: any[] =
          Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, routeHandler) || [];
        const routeInterceptors: any[] =
          Reflect.getMetadata(INTERCEPTORS_METADATA, routeHandler) || [];
        const routePipes: any[] = Reflect.getMetadata(PIPES_METADATA, routeHandler) || [];
        const paramsMetadata = paramsByHandler[route.handlerName] || [];

        // Auto-inject DTO schema when @Body(MyDto) is used and no explicit
        // body schema was provided on the route decorator.
        const schema = this.resolveSchema(route, paramsMetadata);

        routes.push({
          ...route,
          schema,
          controller,
          controllerInstance,
          fullPath: this.normalizePath(prefix, route.path),
          middlewares: [...controllerMiddlewares, ...routeMiddlewares],
          guards: [...controllerGuards, ...routeGuards],
          filters: [...controllerFilters, ...routeFilters],
          interceptors: [...controllerInterceptors, ...routeInterceptors],
          pipes: [...controllerPipes, ...routePipes],
          paramsMetadata,
        });
      }
    }

    return routes;
  }

  private resolveSchema(
    route: RouteMetadata,
    paramsMetadata: ParamMetadata[],
  ): RouteMetadata["schema"] {
    // If the route already declares an explicit body schema, respect it.
    if (route.schema?.body) return route.schema;

    for (const param of paramsMetadata) {
      if (param.type === "body" && param.dtoClass) {
        const dtoSchema = getDtoSchema(param.dtoClass);
        if (dtoSchema) {
          return { ...route.schema, body: dtoSchema };
        }
      }
    }

    return route.schema;
  }

  private normalizePath(prefix: string, path: string): string {
    const joined = `/${prefix}/${path}`.replace(/\/+/g, "/");
    return joined.endsWith("/") && joined.length > 1 ? joined.slice(0, -1) : joined;
  }
}
