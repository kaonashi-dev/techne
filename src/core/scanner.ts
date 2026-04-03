import "../reflect-setup";
import { MODULE_METADATA } from "../common/constants";
import { Container, globalContainer, isCustomProvider } from "./container";
import { Logger } from "../services/logger.service";

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

  public scan(module: any): void {
    this.scanModule(module);

    for (const provider of this.providers) {
      if (isCustomProvider(provider)) {
        const token = provider.provide;
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${String(token?.name || token)}`);
        }
        this.container.addProvider(provider);
        this.container.get(token);
      } else {
        if (this.options?.logger !== false) {
          this.logger.debug(`Initializing provider ${provider.name || "UnknownProvider"}`);
        }
        this.container.get(provider);
      }
    }

    this.callLifecycleHookSync("onModuleInit");
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

    const exportedTokens = new Set<any>();
    for (const exp of exports) {
      exportedTokens.add(isCustomProvider(exp) ? exp.provide : exp);
    }
    this.moduleExports.set(module, exportedTokens);

    for (const provider of providers) {
      this.providers.add(provider);
    }

    for (const controller of controllers) {
      this.controllers.add(controller);
    }

    for (const importedModule of imports) {
      this.scanModule(importedModule);
    }
  }
}
