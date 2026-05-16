import "../reflect-setup";
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
  // Insertion-ordered mirrors of the Sets above; we maintain both so that
  // hot read paths (`getProviders` / `getControllers`) can return a stable
  // array without spreading the Set on every call.
  private controllersList: any[] = [];
  private providersList: any[] = [];
  private logger: Logger;
  private container: Container;

  constructor(private options?: { logger?: boolean; container?: Container }) {
    this.logger = new Logger("Scanner");
    this.container = options?.container || globalContainer;
  }

  public getProviders(): readonly any[] {
    return this.providersList;
  }

  public getControllers(): readonly any[] {
    return this.controllersList;
  }

  public getContainer(): Container {
    return this.container;
  }

  public scanFlat(config: { controllers?: any[]; providers?: any[] }): void {
    const providers = config.providers;
    if (providers) {
      for (const provider of providers) {
        if (!this.providers.has(provider)) {
          this.providers.add(provider);
          this.providersList.push(provider);
        }
        if (isCustomProvider(provider)) {
          this.container.addProvider(provider);
        }
      }
    }
    const controllers = config.controllers;
    if (controllers) {
      for (const controller of controllers) {
        if (!this.controllers.has(controller)) {
          this.controllers.add(controller);
          this.controllersList.push(controller);
        }
        this.container.registerController(controller);
      }
    }
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
        const instance = this.container.get(token) as any;
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
        const instance = this.container.get(controller) as any;
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
}
