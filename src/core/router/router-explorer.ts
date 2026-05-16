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
import {
  type ControllerDescriptor,
  getControllerDescriptor,
  type HandlerDescriptor,
} from "../metadata-store";
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

interface AggregateMeta {
  prefix: string;
  versions: string[];
  routes: RouteMetadata[];
  middlewares: any[];
  guards: any[];
  filters: any[];
  responseHooks: any[];
  paramsByHandler: Record<string, ParamMetadata[]>;
  getHandler: (name: string) => HandlerDescriptor;
}

const EMPTY_HANDLER: HandlerDescriptor = Object.freeze({
  middlewares: [],
  guards: [],
  filters: [],
  responseHooks: [],
}) as unknown as HandlerDescriptor;

function readLegacyHandler(routeHandler: Function): HandlerDescriptor {
  return {
    middlewares: Reflect.getMetadata(MIDDLEWARE_METADATA, routeHandler) || [],
    guards: Reflect.getMetadata(GUARDS_METADATA, routeHandler) || [],
    filters: Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, routeHandler) || [],
    responseHooks: Reflect.getMetadata(ON_RESPONSE_METADATA, routeHandler) || [],
    versions: Reflect.getMetadata(VERSION_METADATA, routeHandler) as string[] | undefined,
  };
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

      // Fast path: read everything from the symbol-keyed descriptor populated
      // by decorators.  Falls back to per-key reads for legacy/third-party
      // decorators that only invoke `Reflect.defineMetadata`.
      const descriptor = getControllerDescriptor(controller);
      const aggregate = descriptor
        ? this.readFromDescriptor(controller, descriptor)
        : this.readFromMetadata(controller);

      const controllerRoutes: DiscoveredRouteDefinition[] = [];

      for (const route of aggregate.routes) {
        const handler = aggregate.getHandler(route.handlerName);
        const paramTypes =
          (Reflect.getMetadata("design:paramtypes", controller.prototype, route.handlerName) as
            | Function[]
            | undefined) ?? [];
        const methodParams = aggregate.paramsByHandler[route.handlerName] || [];
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
          fullPath: this.normalizePath(aggregate.prefix, route.path),
          middlewares: [...aggregate.middlewares, ...handler.middlewares],
          guards: [...aggregate.guards, ...handler.guards],
          filters: [...aggregate.filters, ...handler.filters],
          responseHooks: [...aggregate.responseHooks, ...handler.responseHooks],
          paramsMetadata,
          versions: handler.versions ?? aggregate.versions,
        });
      }

      this.discoveredRoutesCache.set(controller, controllerRoutes);
      routes.push(...controllerRoutes);
    }

    return routes;
  }

  /**
   * Symbol-keyed fast path: one property read replaces 9 controller-level and
   * 6 handler-level `Reflect.getMetadata` lookups.
   */
  private readFromDescriptor(controller: any, descriptor: ControllerDescriptor): AggregateMeta {
    return {
      prefix: descriptor.prefix ?? "",
      versions: descriptor.versions ?? [],
      routes: descriptor.routes,
      middlewares: descriptor.middlewares,
      guards: descriptor.guards,
      filters: descriptor.filters,
      responseHooks: descriptor.responseHooks,
      paramsByHandler: descriptor.paramsByHandler,
      getHandler: (name) => {
        // Per-handler descriptors are sparse — only created for handlers that
        // had at least one method decorator.  Fall back to an empty struct.
        const existing = descriptor.handlers[name];
        if (existing) return existing;
        // Some method decorators (e.g. third-party ones, or pre-descriptor
        // legacy code) may only have written via `Reflect.defineMetadata`.
        // Pick those up from the function reference.
        const routeHandler = controller.prototype[name];
        if (!routeHandler) return EMPTY_HANDLER;
        return readLegacyHandler(routeHandler);
      },
    };
  }

  /**
   * Legacy fall-through: every metadata key read explicitly.  Used when no
   * descriptor was attached (third-party decorator chain that wrote via
   * `Reflect.defineMetadata` only).
   */
  private readFromMetadata(controller: any): AggregateMeta {
    const prefix = (Reflect.getMetadata(CONTROLLER_METADATA, controller) as string) || "";
    const versions = (Reflect.getMetadata(VERSION_METADATA, controller) as string[]) || [];
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA, controller) || [];
    const middlewares: any[] = Reflect.getMetadata(MIDDLEWARE_METADATA, controller) || [];
    const guards: any[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
    const filters: any[] = Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, controller) || [];
    const responseHooks: any[] = Reflect.getMetadata(ON_RESPONSE_METADATA, controller) || [];
    const paramsByHandler: Record<string, ParamMetadata[]> =
      Reflect.getMetadata(PARAMS_METADATA, controller) || {};
    return {
      prefix,
      versions,
      routes,
      middlewares,
      guards,
      filters,
      responseHooks,
      paramsByHandler,
      getHandler: (name) => {
        const routeHandler = controller.prototype[name];
        if (!routeHandler) return EMPTY_HANDLER;
        return readLegacyHandler(routeHandler);
      },
    };
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
