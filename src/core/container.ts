import "reflect-metadata";
import { INJECT_METADATA } from "../common/constants";

export interface ClassProvider {
  provide: any;
  useClass: any;
}

export interface ValueProvider {
  provide: any;
  useValue: any;
}

export interface FactoryProvider {
  provide: any;
  useFactory: (...args: any[]) => any;
  inject?: any[];
}

export interface ExistingProvider {
  provide: any;
  useExisting: any;
}

export type Provider = ClassProvider | ValueProvider | FactoryProvider | ExistingProvider;

function isClassProvider(provider: any): provider is ClassProvider {
  return provider && typeof provider === "object" && "useClass" in provider;
}

function isValueProvider(provider: any): provider is ValueProvider {
  return provider && typeof provider === "object" && "useValue" in provider;
}

function isFactoryProvider(provider: any): provider is FactoryProvider {
  return provider && typeof provider === "object" && "useFactory" in provider;
}

function isExistingProvider(provider: any): provider is ExistingProvider {
  return provider && typeof provider === "object" && "useExisting" in provider;
}

export function isCustomProvider(provider: any): boolean {
  return (
    isClassProvider(provider) ||
    isValueProvider(provider) ||
    isFactoryProvider(provider) ||
    isExistingProvider(provider)
  );
}

export class Container {
  private instances = new Map<any, any>();
  private resolutionStack = new Set<any>();
  private providers = new Map<any, Provider>();

  public set<T>(token: any, value: T): void {
    this.instances.set(token, value);
  }

  public has(token: any): boolean {
    return this.instances.has(token) || this.providers.has(token);
  }

  public addProvider(provider: Provider): void {
    this.providers.set(provider.provide, provider);
  }

  public get<T>(target: any): T {
    // If it's already instantiated, return the singleton
    if (this.instances.has(target)) {
      return this.instances.get(target);
    }

    // Check if there's a custom provider registered for this token
    if (this.providers.has(target)) {
      return this.resolveProvider<T>(target);
    }

    // For class-based resolution, validate it's a constructable function
    if (typeof target !== "function") {
      throw new Error(
        `Cannot resolve token: ${String(target)}. No provider registered and it's not a class.`,
      );
    }

    // Check for circular dependencies
    if (this.resolutionStack.has(target)) {
      throw new Error(`Circular dependency detected: ${target?.name || target}`);
    }

    this.resolutionStack.add(target);

    try {
      // Get the dependencies from the constructor
      const tokens: any[] = Reflect.getMetadata("design:paramtypes", target) || [];

      // Resolve injected tokens (from @Inject decorator)
      const injectTokens: Record<number, any> = Reflect.getMetadata(INJECT_METADATA, target) || {};

      // Resolve all dependencies recursively
      const injections = tokens.map((token: any, index: number) => {
        // If @Inject was used at this index, use that token instead
        const resolvedToken = injectTokens[index] !== undefined ? injectTokens[index] : token;
        return this.get(resolvedToken);
      });

      // Instantiate and store
      const instance = new target(...injections);
      this.instances.set(target, instance);

      return instance;
    } finally {
      this.resolutionStack.delete(target);
    }
  }

  private resolveProvider<T>(token: any): T {
    const provider = this.providers.get(token)!;

    if (isValueProvider(provider)) {
      this.instances.set(token, provider.useValue);
      return provider.useValue;
    }

    if (isClassProvider(provider)) {
      const instance = this.get(provider.useClass);
      this.instances.set(token, instance);
      return instance as T;
    }

    if (isFactoryProvider(provider)) {
      const deps = (provider.inject || []).map((dep: any) => this.get(dep));
      const instance = provider.useFactory(...deps);
      this.instances.set(token, instance);
      return instance as T;
    }

    if (isExistingProvider(provider)) {
      const instance = this.get(provider.useExisting);
      this.instances.set(token, instance);
      return instance as T;
    }

    throw new Error(`Invalid provider configuration for token: ${String(token)}`);
  }

  public reset(): void {
    this.instances.clear();
    this.resolutionStack.clear();
    this.providers.clear();
  }
}

export const globalContainer = new Container();
