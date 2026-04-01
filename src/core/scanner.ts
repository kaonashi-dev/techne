import "reflect-metadata";
import {
  MODULE_METADATA,
  ROUTES_METADATA,
  CONTROLLER_METADATA,
  MIDDLEWARE_METADATA,
  GUARDS_METADATA,
} from "../common/constants";
import { Container, isCustomProvider } from "./container";
import { globalContainer } from "./container";
import type { RouteMetadata } from "../decorators/routes.decorator";
import { Logger } from "../services/logger.service";

export interface RouteDefinition extends RouteMetadata {
  controller: any;
  controllerInstance: any;
  fullPath: string;
  middlewares: any[];
  guards: any[];
}

export class Scanner {
  private controllers = new Set<any>();
  private providers = new Set<any>();
  private processedModules = new Set<any>();
  private moduleExports = new Map<any, Set<any>>();
  private logger: Logger;
  private container: Container;

  constructor(private options?: { logger?: boolean; container?: Container }) {
    this.logger = new Logger("Scanner");
    this.container = options?.container || globalContainer;
  }

  public scan(module: any): RouteDefinition[] {
    this.scanModule(module);

    // Initialize all providers first
    for (const provider of this.providers) {
      if (isCustomProvider(provider)) {
        const token = provider.provide;
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${String(token?.name || token)}`);
        }
        this.container.addProvider(provider);
        // Eagerly resolve
        this.container.get(token);
      } else {
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${provider.name || "UnknownProvider"}`);
        }
        this.container.get(provider);
      }
    }

    // Call synchronous lifecycle hooks (async ones must be called explicitly via callLifecycleHook)
    this.callLifecycleHookSync("onModuleInit");

    const routeDefinitions: RouteDefinition[] = [];

    // Process all controllers
    for (const controller of this.controllers) {
      const controllerInstance = this.container.get(controller);
      const prefix = (Reflect.getMetadata(CONTROLLER_METADATA, controller) as string) || "";
      const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA, controller) || [];
      const controllerMiddlewares: any[] =
        Reflect.getMetadata(MIDDLEWARE_METADATA, controller) || [];
      const controllerGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];

      for (const route of routes) {
        // Normalize path
        const fullPath = this.normalizePath(prefix, route.path);
        const routeMiddlewares: any[] =
          Reflect.getMetadata(MIDDLEWARE_METADATA, controller.prototype[route.handlerName]) || [];
        const routeGuards: any[] =
          Reflect.getMetadata(GUARDS_METADATA, controller.prototype[route.handlerName]) || [];

        routeDefinitions.push({
          ...route,
          controller,
          controllerInstance,
          fullPath,
          middlewares: [...controllerMiddlewares, ...routeMiddlewares],
          guards: [...controllerGuards, ...routeGuards],
        });
      }
    }

    return routeDefinitions;
  }

  public getProviders(): any[] {
    return [...this.providers];
  }

  public getControllers(): any[] {
    return [...this.controllers];
  }

  public getContainer(): Container {
    return this.container;
  }

  private callLifecycleHookSync(
    hook: "onModuleInit" | "onModuleDestroy" | "onApplicationBootstrap",
  ) {
    for (const provider of this.providers) {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      try {
        const instance = this.container.get(token);
        if (instance && typeof instance[hook] === "function") {
          instance[hook]();
        }
      } catch {
        // Provider may not be resolvable yet during init
      }
    }

    for (const controller of this.controllers) {
      try {
        const instance = this.container.get(controller);
        if (instance && typeof instance[hook] === "function") {
          instance[hook]();
        }
      } catch {
        // Controller may not be resolvable yet during init
      }
    }
  }

  public async callLifecycleHook(
    hook: "onModuleInit" | "onModuleDestroy" | "onApplicationBootstrap",
  ) {
    for (const provider of this.providers) {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      try {
        const instance = this.container.get(token);
        if (instance && typeof instance[hook] === "function") {
          await instance[hook]();
        }
      } catch {
        // Provider may not be resolvable yet during init
      }
    }

    for (const controller of this.controllers) {
      try {
        const instance = this.container.get(controller);
        if (instance && typeof instance[hook] === "function") {
          await instance[hook]();
        }
      } catch {
        // Controller may not be resolvable yet during init
      }
    }
  }

  private scanModule(module: any) {
    if (this.processedModules.has(module)) {
      return;
    }
    this.processedModules.add(module);

    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as any[]) || [];
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module) as any[]) || [];
    const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) as any[]) || [];
    const exports = (Reflect.getMetadata(MODULE_METADATA.EXPORTS, module) as any[]) || [];

    // Track what this module exports
    const exportedTokens = new Set<any>();
    for (const exp of exports) {
      exportedTokens.add(isCustomProvider(exp) ? exp.provide : exp);
    }
    this.moduleExports.set(module, exportedTokens);

    // Register providers from this module
    for (const provider of providers) {
      this.providers.add(provider);
    }

    for (const controller of controllers) {
      this.controllers.add(controller);
    }

    // Process imported modules — only their exported providers become available
    for (const importedModule of imports) {
      this.scanModule(importedModule);
    }
  }

  private normalizePath(prefix: string, path: string): string {
    const joined = `/${prefix}/${path}`.replace(/\/+/g, "/");
    return joined.endsWith("/") && joined.length > 1 ? joined.slice(0, -1) : joined;
  }
}
