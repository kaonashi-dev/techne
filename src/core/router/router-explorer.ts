import {
  CONTROLLER_METADATA,
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
  MIDDLEWARE_METADATA,
  ON_RESPONSE_METADATA,
  PARAMS_METADATA,
  ROUTES_METADATA,
  VERSION_METADATA,
} from "../../common/constants";
import type { ParamMetadata } from "../../decorators/params.decorator";
import type { RouteMetadata } from "../../decorators/routes.decorator";
import { getOrCreateDtoSchema } from "../../schema/dto";
import { Logger } from "../../services/logger.service";
import type { Scanner } from "../scanner";

export interface DiscoveredRouteDefinition extends RouteMetadata {
  controller: any;
  fullPath: string;
  middlewares: any[];
  guards: any[];
  filters: any[];
  responseHooks: any[];
  paramsMetadata: ParamMetadata[];
  versions: string[];
}

export class RouterExplorer {
  private readonly discoveredRoutesCache = new WeakMap<any, DiscoveredRouteDefinition[]>();
  private readonly logger = new Logger("RouterExplorer");

  constructor(private readonly scanner: Scanner) {}

  public explore(): DiscoveredRouteDefinition[] {
    const routes: DiscoveredRouteDefinition[] = [];

    for (const controller of this.scanner.getControllers()) {
      const cachedRoutes = this.discoveredRoutesCache.get(controller);
      if (cachedRoutes) {
        routes.push(...cachedRoutes);
        continue;
      }

      const prefix = (Reflect.getMetadata(CONTROLLER_METADATA, controller) as string) || "";
      const controllerVersions =
        (Reflect.getMetadata(VERSION_METADATA, controller) as string[]) || [];
      const routeMetadata: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA, controller) || [];
      const controllerMiddlewares: any[] =
        Reflect.getMetadata(MIDDLEWARE_METADATA, controller) || [];
      const controllerGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
      const controllerFilters: any[] =
        Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, controller) || [];
      const controllerResponseHooks: any[] =
        Reflect.getMetadata(ON_RESPONSE_METADATA, controller) || [];
      const paramsByHandler: Record<string, ParamMetadata[]> =
        Reflect.getMetadata(PARAMS_METADATA, controller) || {};
      const controllerRoutes: DiscoveredRouteDefinition[] = [];

      for (const route of routeMetadata) {
        const routeHandler = controller.prototype[route.handlerName];
        const routeVersions =
          (Reflect.getMetadata(VERSION_METADATA, routeHandler) as string[] | undefined) ??
          controllerVersions;
        const paramTypes =
          (Reflect.getMetadata("design:paramtypes", controller.prototype, route.handlerName) as
            | Function[]
            | undefined) ?? [];
        const routeMiddlewares: any[] =
          Reflect.getMetadata(MIDDLEWARE_METADATA, routeHandler) || [];
        const routeGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, routeHandler) || [];
        const routeFilters: any[] =
          Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, routeHandler) || [];
        const routeResponseHooks: any[] =
          Reflect.getMetadata(ON_RESPONSE_METADATA, routeHandler) || [];
        const methodParams = paramsByHandler[route.handlerName] || [];
        const paramsMetadata =
          methodParams.length === 0
            ? []
            : methodParams.map((param) => ({
                ...param,
                metatype: param.dtoClass ?? param.metatype ?? paramTypes[param.index],
              }));

        // Auto-inject DTO schema when @Body(MyDto) is used and no explicit
        // body schema was provided on the route decorator.
        const schema = this.resolveSchema(route, paramsMetadata);

        controllerRoutes.push({
          ...route,
          schema,
          controller,
          fullPath: this.normalizePath(prefix, route.path),
          middlewares: [...controllerMiddlewares, ...routeMiddlewares],
          guards: [...controllerGuards, ...routeGuards],
          filters: [...controllerFilters, ...routeFilters],
          responseHooks: [...controllerResponseHooks, ...routeResponseHooks],
          paramsMetadata,
          versions: routeVersions,
        });
      }

      this.discoveredRoutesCache.set(controller, controllerRoutes);
      routes.push(...controllerRoutes);
    }

    return routes;
  }

  private resolveSchema(
    route: RouteMetadata,
    paramsMetadata: ParamMetadata[],
  ): RouteMetadata["schema"] {
    const bodyDtoParam = paramsMetadata.find(
      (param) => param.type === "body" && (param.dtoClass || param.metatype),
    );
    if (route.schema?.body) {
      if (bodyDtoParam) {
        this.logger.warn(
          `${route.handlerName} declares both @Body(Dto) and a route body schema; using the route schema.`,
        );
      }
      return route.schema;
    }

    for (const param of paramsMetadata) {
      if (param.type === "body" && param.dtoClass) {
        const dtoSchema = getOrCreateDtoSchema(param.dtoClass);
        if (dtoSchema) {
          return { ...route.schema, body: dtoSchema };
        }
      }

      if (param.type === "body" && param.metatype) {
        const dtoSchema = getOrCreateDtoSchema(param.metatype);
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
