import "../reflect-setup";
import { Container, type Provider, isCustomProvider } from "../core/container";
import { Scanner } from "../core/scanner";
import type { ModuleMetadata } from "../decorators/module.decorator";
import { Logger } from "../services/logger.service";

export interface OverrideProvider {
  useValue(value: any): TestingModuleBuilder;
  useClass(cls: any): TestingModuleBuilder;
  useFactory(options: { factory: (...args: any[]) => any; inject?: any[] }): TestingModuleBuilder;
}

export class TestingModuleBuilder {
  private overrides = new Map<any, Provider>();

  constructor(private metadata: ModuleMetadata) {}

  overrideProvider(token: any): OverrideProvider {
    return {
      useValue: (value: any) => {
        this.overrides.set(token, { provide: token, useValue: value });
        return this;
      },
      useClass: (cls: any) => {
        this.overrides.set(token, { provide: token, useClass: cls });
        return this;
      },
      useFactory: (options: { factory: (...args: any[]) => any; inject?: any[] }) => {
        this.overrides.set(token, {
          provide: token,
          useFactory: options.factory,
          inject: options.inject,
        });
        return this;
      },
    };
  }

  async compile(): Promise<TestingModule> {
    Logger.setEnabled(false);

    const container = new Container();

    // Apply overrides first so they take priority during resolution
    for (const [, provider] of this.overrides) {
      container.addProvider(provider);
    }

    // Register custom providers (that aren't overridden)
    const providers = this.metadata.providers || [];
    for (const provider of providers) {
      if (isCustomProvider(provider)) {
        const token = provider.provide;
        // Don't register if overridden
        if (!this.overrides.has(token)) {
          container.addProvider(provider);
        }
      }
    }

    if (this.metadata.imports && this.metadata.imports.length > 0) {
      // Create a temporary module wrapper with the metadata
      const TempModule = class {};
      Reflect.defineMetadata("imports", this.metadata.imports, TempModule);

      // Filter out overridden providers before passing to scanner
      const filteredProviders = providers.filter((p: any) => {
        const token = isCustomProvider(p) ? p.provide : p;
        return !this.overrides.has(token);
      });
      Reflect.defineMetadata("providers", filteredProviders, TempModule);
      Reflect.defineMetadata("controllers", this.metadata.controllers || [], TempModule);
      Reflect.defineMetadata("exports", this.metadata.exports || [], TempModule);

      const scanner = new Scanner({ logger: false, container });
      await scanner.scan(TempModule);
    } else {
      // Eagerly resolve class providers (that aren't overridden)
      for (const provider of providers) {
        if (!isCustomProvider(provider) && !this.overrides.has(provider)) {
          container.get(provider);
        }
      }

      // Call onModuleInit on all resolved providers
      for (const provider of providers) {
        const token = isCustomProvider(provider) ? provider.provide : provider;
        try {
          const instance = container.get(token) as any;
          if (instance && typeof instance.onModuleInit === "function") {
            await instance.onModuleInit();
          }
        } catch {
          // skip unresolvable
        }
      }
    }

    // Now resolve all overridden tokens to ensure they are cached
    for (const [token] of this.overrides) {
      container.get(token);
    }

    // Register controllers
    const controllers = this.metadata.controllers || [];
    for (const controller of controllers) {
      container.get(controller);
    }

    return new TestingModule(container);
  }
}

export class TestingModule {
  constructor(private container: Container) {}

  get<T>(token: any): T {
    return this.container.get<T>(token);
  }

  getContainer(): Container {
    return this.container;
  }
}

export class Test {
  static createTestingModule(metadata: ModuleMetadata): TestingModuleBuilder {
    return new TestingModuleBuilder(metadata);
  }
}
