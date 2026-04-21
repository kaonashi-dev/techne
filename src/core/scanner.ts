import "../reflect-setup";
import { MODULE_METADATA } from "../common/constants";
import {
  Container,
  getClassScope,
  getProviderScope,
  globalContainer,
  isCustomProvider,
} from "./container";
import { Scope } from "./scope";
import { Logger } from "../services/logger.service";

export class Scanner {
  private controllers = new Set<any>();
  private providers = new Set<any>();
  private processedModules = new Set<any>();
  private moduleExports = new Map<any, Set<any>>();
  private controllerModules = new Map<any, any>();
  private logger: Logger;
  private container: Container;

  constructor(private options?: { logger?: boolean; container?: Container }) {
    this.logger = new Logger("Scanner");
    this.container = options?.container || globalContainer;
  }

  public async scan(module: any): Promise<void> {
    this.scanModule(module);
    this.container.finalizeModules(module);

    for (const provider of this.providers) {
      if (isCustomProvider(provider)) {
        const token = provider.provide;
        const scope = getProviderScope(provider);
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${String(token?.name || token)}`);
        }
        this.container.addProvider(provider, this.container.getModuleFor(token));
        if (scope === Scope.DEFAULT && this.container.isStatic(token)) {
          this.container.get(token, { module: this.container.getModuleFor(token) });
        }
      } else {
        const scope = getClassScope(provider);
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${provider.name || "UnknownProvider"}`);
        }
        if (scope === Scope.DEFAULT && this.container.isStatic(provider)) {
          this.container.get(provider, { module: this.container.getModuleFor(provider) });
        }
      }
    }

    await this.callLifecycleHook("onModuleInit");
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

  public getModuleExports(): Map<any, Set<any>> {
    return this.moduleExports;
  }

  public getControllerModule(controller: any): any {
    return this.controllerModules.get(controller);
  }

  public async callLifecycleHook(
    hook: "onModuleInit" | "onModuleDestroy" | "onApplicationBootstrap",
  ) {
    for (const provider of this.providers) {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      try {
        if (isCustomProvider(provider) && getProviderScope(provider) !== Scope.DEFAULT) {
          continue;
        }
        if (!isCustomProvider(provider) && getClassScope(provider) !== Scope.DEFAULT) {
          continue;
        }
        if (!this.container.isStatic(token)) {
          continue;
        }
        const instance = this.container.get(token, {
          module: this.container.getModuleFor(token),
        }) as any;
        if (instance && typeof instance[hook] === "function") {
          await instance[hook]();
        }
      } catch (error: any) {
        const name = token?.name || String(token);
        this.logger.error(
          `Failed to call ${hook} on provider ${name}: ${error?.message || error}`,
          error?.stack,
          "Lifecycle",
        );
      }
    }

    for (const controller of this.controllers) {
      try {
        if (getClassScope(controller) !== Scope.DEFAULT || !this.container.isStatic(controller)) {
          continue;
        }
        const instance = this.container.get(controller, {
          module: this.controllerModules.get(controller),
        }) as any;
        if (instance && typeof instance[hook] === "function") {
          await instance[hook]();
        }
      } catch (error: any) {
        const name = controller?.name || String(controller);
        this.logger.error(
          `Failed to call ${hook} on controller ${name}: ${error?.message || error}`,
          error?.stack,
          "Lifecycle",
        );
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
    const global = (Reflect.getMetadata(MODULE_METADATA.GLOBAL, module) as boolean) || false;

    this.container.registerModule(module, {
      controllers,
      exports,
      global,
      imports,
      providers,
    });

    const exportedTokens = new Set<any>();
    for (const exp of exports) {
      exportedTokens.add(isCustomProvider(exp) ? exp.provide : exp);
    }
    this.moduleExports.set(module, exportedTokens);

    for (const importedModule of imports) {
      this.scanModule(importedModule);
    }

    for (const provider of providers) {
      this.providers.add(provider);
    }

    for (const controller of controllers) {
      this.controllers.add(controller);
      this.controllerModules.set(controller, module);
      this.container.registerController(controller, module);
    }
  }
}
