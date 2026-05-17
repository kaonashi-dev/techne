import "../reflect-setup";
import { Container, type Provider, isCustomProvider } from "../core/container";
import { Scanner } from "../core/scanner";
import { Logger, NullSink, BufferSink } from "../services/logger.service";
import { MqRegistry } from "../mq/registry";
import { MQ_DRIVER } from "../mq/tokens";

export interface TestingModuleMetadata {
  controllers?: any[];
  providers?: any[];
}

export interface OverrideProvider {
  useValue(value: any): TestingModuleBuilder;
  useClass(cls: any): TestingModuleBuilder;
  useFactory(options: { factory: (...args: any[]) => any; inject?: any[] }): TestingModuleBuilder;
}

export class TestingModuleBuilder {
  private overrides = new Map<any, Provider>();

  constructor(private metadata: TestingModuleMetadata) {}

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
    // Install a null sink so tests never pollute stdout even if internal code
    // enables logging. Tests that need to assert on log output should install a
    // BufferSink via Logger.setSink() and restore the previous sink afterward.
    Logger.setSink(new NullSink());

    const container = new Container();

    // Apply overrides first so they take priority during resolution
    for (const [, provider] of this.overrides) {
      container.addProvider(provider);
    }

    const providers = this.metadata.providers || [];
    const filteredProviders = providers.filter((provider: any) => {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      return !this.overrides.has(token);
    });

    const scanner = new Scanner({ logger: false, container });
    scanner.scanFlat({
      controllers: this.metadata.controllers || [],
      providers: filteredProviders,
    });

    for (const provider of scanner.getProviders()) {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      try {
        if (container.isStatic(token)) {
          container.get(token);
        }
      } catch {
        // skip unresolvable providers so tests can override later
      }
    }
    await scanner.callLifecycleHook("onModuleInit");

    // Now resolve all overridden tokens to ensure they are cached
    for (const [token] of this.overrides) {
      container.get(token);
    }

    if (container.has(MQ_DRIVER)) {
      const mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
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
  static createTestingModule(metadata: TestingModuleMetadata): TestingModuleBuilder {
    return new TestingModuleBuilder(metadata);
  }
}
