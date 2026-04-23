import type { Scanner } from "../scanner";
import type { ElysiaAdapter } from "../../platform/elysia-adapter";
import type { RouteRegistrationOptions } from "../http-options";
import { RouterExecutionContext } from "./router-execution-context";
import { RouterExplorer, type DiscoveredRouteDefinition } from "./router-explorer";
import { RouterResponseController } from "./router-response-controller";

export class RoutesResolver {
  private readonly explorer: RouterExplorer;
  private readonly responseController = new RouterResponseController();
  public readonly executionContext = new RouterExecutionContext(this.responseController);

  constructor(private readonly scanner: Scanner) {
    this.explorer = new RouterExplorer(scanner);
  }

  public resolve(adapter: ElysiaAdapter, options: RouteRegistrationOptions = {}) {
    const container = this.scanner.getContainer();
    const routes = [];
    this.executionContext.resetRoutes();

    for (const route of this.explorer.explore()) {
      for (const expandedRoute of this.expandRoute(route, options)) {
        routes.push(this.executionContext.create(expandedRoute, container));
      }
    }

    adapter.registerRoutes(routes);
    return routes;
  }

  private expandRoute(
    route: DiscoveredRouteDefinition,
    options: RouteRegistrationOptions,
  ): DiscoveredRouteDefinition[] {
    const prefixedPath = this.applyGlobalPrefix(route.fullPath, options.globalPrefix);
    const versioning = options.versioning;
    if (!versioning) {
      return [{ ...route, fullPath: prefixedPath }];
    }

    const versions =
      route.versions.length > 0
        ? route.versions
        : this.normalizeVersions(versioning.defaultVersion);
    if (versions.length === 0) {
      return [{ ...route, fullPath: prefixedPath }];
    }

    if (versioning.type === "uri") {
      return versions.map((version) => ({
        ...route,
        fullPath: this.applyUriVersion(prefixedPath, version, versioning.prefix),
      }));
    }

    return versions.map((version) => ({
      ...route,
      fullPath: prefixedPath,
      middlewares: [...route.middlewares, this.createVersionHeaderMiddleware(version, versioning)],
    }));
  }

  private applyGlobalPrefix(
    fullPath: string,
    globalPrefix?: RouteRegistrationOptions["globalPrefix"],
  ): string {
    if (!globalPrefix?.prefix) return fullPath;
    if (globalPrefix.exclude?.includes(fullPath)) return fullPath;
    return this.normalizePath(globalPrefix.prefix, fullPath);
  }

  private applyUriVersion(path: string, version: string, prefix: string | false = "v"): string {
    const versionSegment = prefix === false ? version : `${prefix}${version}`;
    return this.normalizePath(versionSegment, path);
  }

  private createVersionHeaderMiddleware(
    version: string,
    options: NonNullable<RouteRegistrationOptions["versioning"]>,
  ) {
    return (context: any) => {
      const resolved =
        options.extractor?.(context.request) ??
        context.request.headers.get(options.header ?? "x-version") ??
        undefined;
      const versions = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
      if (versions.includes(version)) {
        return;
      }
      context.set.status = 404;
      return { message: "Not Found" };
    };
  }

  private normalizePath(prefix: string, path: string): string {
    const joined = `/${prefix}/${path}`.replace(/\/+/g, "/");
    return joined.endsWith("/") && joined.length > 1 ? joined.slice(0, -1) : joined;
  }

  private normalizeVersions(input?: string | string[]): string[] {
    if (!input) return [];
    return Array.isArray(input) ? input : [input];
  }
}
