import "../reflect-setup";
import { INJECT_METADATA, INQUIRER, REQUEST, SCOPE_OPTIONS_METADATA } from "../common/constants";
import { Reflector } from "./reflector";
import { ModuleRef } from "./module-ref";
import { Scope, type ScopeOptions } from "./scope";

export interface ClassProvider {
  provide: any;
  useClass: any;
  scope?: Scope;
}

export interface ValueProvider {
  provide: any;
  useValue: any;
}

export interface FactoryProvider {
  provide: any;
  useFactory: (...args: any[]) => any;
  inject?: any[];
  scope?: Scope;
}

export interface ExistingProvider {
  provide: any;
  useExisting: any;
  scope?: Scope;
}

export type Provider = ClassProvider | ValueProvider | FactoryProvider | ExistingProvider;

export interface ResolutionContext {
  contextId?: symbol;
  inquirer?: any;
  module?: any;
  request?: any;
}

export interface ModuleRegistration {
  controllers?: any[];
  exports?: any[];
  global?: boolean;
  imports?: any[];
  providers?: any[];
}

export function getScopeOptions(target: any): ScopeOptions {
  if (typeof target !== "function") return {};
  return (Reflect.getMetadata(SCOPE_OPTIONS_METADATA, target) as ScopeOptions | undefined) ?? {};
}

export function getClassScope(target: any): Scope {
  return getScopeOptions(target).scope ?? Scope.DEFAULT;
}

export function getProviderScope(provider: Provider): Scope {
  if ("scope" in provider && provider.scope) return provider.scope;
  if (isClassProvider(provider)) return getClassScope(provider.useClass);
  if (isExistingProvider(provider)) return getClassScope(provider.useExisting);
  return Scope.DEFAULT;
}

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

const BUILT_IN_TOKENS = new Set<any>([Reflector, ModuleRef]);
const paramTypesCache = new Map<Function, any[]>();
const injectTokensCache = new Map<Function, Record<number, any>>();

export class Container {
  private instances = new Map<any, any>();
  private requestInstances = new Map<symbol, Map<any, any>>();
  private resolutionStack = new Set<any>();
  private staticCache = new Map<any, boolean>();
  private providers = new Map<any, Provider>();
  private moduleImports = new Map<any, any[]>();
  private moduleOwnTokens = new Map<any, Set<any>>();
  private moduleRawExports = new Map<any, any[]>();
  private moduleVisibleTokens = new Map<any, Set<any>>();
  private moduleOwners = new Map<any, any>();
  private globalModules = new Set<any>();
  private rootModule?: any;

  constructor() {
    this.instances.set(Reflector, new Reflector());
    this.instances.set(ModuleRef, new ModuleRef(this));
  }

  public set<T>(token: any, value: T): void {
    this.instances.set(token, value);
  }

  public has(token: any): boolean {
    return this.instances.has(token) || this.providers.has(token);
  }

  public getProviderDefinition(token: any): Provider | undefined {
    return this.providers.get(token);
  }

  public addProvider(provider: Provider, module?: any): void {
    this.providers.set(provider.provide, provider);
    this.staticCache.delete(provider.provide);
    if (module) {
      this.addOwnedToken(module, provider.provide);
      this.moduleOwners.set(provider.provide, module);
    }
  }

  public registerController(controller: any, module: any): void {
    this.staticCache.delete(controller);
    this.addOwnedToken(module, controller);
    this.moduleOwners.set(controller, module);
  }

  public registerModule(module: any, metadata: ModuleRegistration): void {
    this.staticCache.clear();
    this.moduleImports.set(module, metadata.imports ?? []);
    this.moduleRawExports.set(module, metadata.exports ?? []);
    this.moduleOwnTokens.set(module, this.moduleOwnTokens.get(module) ?? new Set());

    for (const provider of metadata.providers ?? []) {
      const token = isCustomProvider(provider) ? provider.provide : provider;
      this.addOwnedToken(module, token);
      this.moduleOwners.set(token, module);
    }

    for (const controller of metadata.controllers ?? []) {
      this.addOwnedToken(module, controller);
      this.moduleOwners.set(controller, module);
    }

    if (metadata.global) {
      this.globalModules.add(module);
    }
  }

  public finalizeModules(rootModule: any): void {
    this.rootModule = rootModule;
    this.moduleVisibleTokens.clear();
    this.staticCache.clear();

    for (const module of this.moduleImports.keys()) {
      this.computeVisibleTokens(module, new Set());
    }
  }

  public getRootModule(): any {
    return this.rootModule;
  }

  public getModuleFor(token: any): any {
    return this.moduleOwners.get(token);
  }

  public get<T>(target: any, context?: ResolutionContext): T {
    return this.resolve<T>(target, context);
  }

  public createContextId(): symbol {
    return Symbol("techne:context");
  }

  public clearContext(contextId: symbol): void {
    this.requestInstances.delete(contextId);
  }

  public isStatic(token: any): boolean {
    const cached = this.staticCache.get(token);
    if (cached !== undefined) {
      return cached;
    }

    let resolved: boolean;
    if (this.providers.has(token)) {
      const provider = this.providers.get(token)!;
      resolved =
        getProviderScope(provider) === Scope.DEFAULT && !this.providerHasContextualDeps(provider);
    } else {
      resolved = getClassScope(token) === Scope.DEFAULT && !this.classHasContextualDeps(token);
    }

    this.staticCache.set(token, resolved);
    return resolved;
  }

  public resolve<T>(target: any, context: ResolutionContext = {}): T {
    const moduleContext = this.resolveModuleContext(target, context);
    if (moduleContext !== undefined) {
      context.module = moduleContext;
    }

    if (target === REQUEST) {
      return context.request as T;
    }

    if (target === INQUIRER) {
      return context.inquirer as T;
    }

    if (target === ModuleRef) {
      return new ModuleRef(this, context.module) as T;
    }

    if (this.providers.has(target)) {
      this.assertAccessible(target, context.module);
      return this.resolveProvider<T>(target, context);
    }

    if (typeof target !== "function") {
      throw new Error(
        `Cannot resolve token: ${String(target)}. No provider registered and it's not a class.`,
      );
    }

    this.assertAccessible(target, context.module);

    if (this.instances.has(target)) {
      return this.instances.get(target);
    }

    const scope = getClassScope(target);
    if (scope === Scope.REQUEST) {
      const contextId = context.contextId ?? (context.request ? this.createContextId() : undefined);
      if (!contextId) {
        throw new Error(
          `Cannot resolve request-scoped provider ${target?.name || target} without a request context.`,
        );
      }
      context.contextId = contextId;
      const scopedInstances = this.getRequestInstances(contextId);
      if (scopedInstances.has(target)) {
        return scopedInstances.get(target);
      }
      const instance = this.instantiateClass<T>(target, context);
      scopedInstances.set(target, instance);
      return instance;
    }

    if (scope === Scope.TRANSIENT) {
      return this.instantiateClass<T>(target, context);
    }

    if (!this.isStatic(target)) {
      const contextId = context.contextId ?? (context.request ? this.createContextId() : undefined);
      if (!contextId) {
        throw new Error(
          `Cannot resolve contextual provider ${target?.name || target} without a request context.`,
        );
      }
      context.contextId = contextId;
      const scopedInstances = this.getRequestInstances(contextId);
      if (scopedInstances.has(target)) {
        return scopedInstances.get(target);
      }
      const instance = this.instantiateClass<T>(target, context);
      scopedInstances.set(target, instance);
      return instance;
    }

    if (this.resolutionStack.has(target)) {
      throw new Error(`Circular dependency detected: ${target?.name || target}`);
    }

    const instance = this.instantiateClass<T>(target, context);
    this.instances.set(target, instance);
    return instance;
  }

  private instantiateClass<T>(target: any, context: ResolutionContext): T {
    this.resolutionStack.add(target);
    try {
      let tokens = paramTypesCache.get(target);
      if (!tokens) {
        tokens = Reflect.getMetadata("design:paramtypes", target) ?? [];
        paramTypesCache.set(target, tokens!);
      }

      let injectTokens = injectTokensCache.get(target);
      if (!injectTokens) {
        injectTokens = Reflect.getMetadata(INJECT_METADATA, target) ?? {};
        injectTokensCache.set(target, injectTokens!);
      }

      const resolvedModule = context.module ?? this.moduleOwners.get(target) ?? this.rootModule;
      const injections = tokens!.map((token: any, index: number) => {
        const resolvedToken = injectTokens![index] !== undefined ? injectTokens![index] : token;
        return this.resolve(resolvedToken, {
          ...context,
          inquirer: target,
          module: resolvedModule,
        });
      });

      return new target(...injections);
    } finally {
      this.resolutionStack.delete(target);
    }
  }

  private resolveProvider<T>(token: any, context: ResolutionContext): T {
    const provider = this.providers.get(token)!;
    const scope = getProviderScope(provider);

    if (scope === Scope.REQUEST) {
      const contextId = context.contextId ?? (context.request ? this.createContextId() : undefined);
      if (!contextId) {
        throw new Error(
          `Cannot resolve request-scoped provider ${String(token)} without a request context.`,
        );
      }
      context.contextId = contextId;
      const scopedInstances = this.getRequestInstances(contextId);
      if (scopedInstances.has(token)) {
        return scopedInstances.get(token);
      }
      const instance = this.createProviderInstance<T>(provider, context);
      scopedInstances.set(token, instance);
      return instance;
    }

    if (scope === Scope.TRANSIENT) {
      return this.createProviderInstance<T>(provider, context);
    }

    if (!this.isStatic(token)) {
      const contextId = context.contextId ?? (context.request ? this.createContextId() : undefined);
      if (!contextId) {
        throw new Error(
          `Cannot resolve contextual provider ${String(token)} without a request context.`,
        );
      }
      context.contextId = contextId;
      const scopedInstances = this.getRequestInstances(contextId);
      if (scopedInstances.has(token)) {
        return scopedInstances.get(token);
      }
      const instance = this.createProviderInstance<T>(provider, context);
      scopedInstances.set(token, instance);
      return instance;
    }

    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    const instance = this.createProviderInstance<T>(provider, context);
    this.instances.set(token, instance);
    return instance;
  }

  private createProviderInstance<T>(provider: Provider, context: ResolutionContext): T {
    if (isValueProvider(provider)) {
      return provider.useValue;
    }

    if (isClassProvider(provider)) {
      return this.resolve(provider.useClass, context) as T;
    }

    if (isFactoryProvider(provider)) {
      const deps = (provider.inject || []).map((dep: any) =>
        this.resolve(dep, {
          ...context,
          inquirer: provider.provide,
        }),
      );
      return provider.useFactory(...deps) as T;
    }

    if (isExistingProvider(provider)) {
      return this.resolve(provider.useExisting, context) as T;
    }

    throw new Error("Invalid provider configuration");
  }

  private getRequestInstances(contextId: symbol): Map<any, any> {
    let scopedInstances = this.requestInstances.get(contextId);
    if (!scopedInstances) {
      scopedInstances = new Map<any, any>();
      this.requestInstances.set(contextId, scopedInstances);
    }
    return scopedInstances;
  }

  private resolveModuleContext(target: any, context: ResolutionContext): any {
    if (context.module !== undefined) {
      return context.module;
    }

    if (context.inquirer && this.moduleOwners.has(context.inquirer)) {
      return this.moduleOwners.get(context.inquirer);
    }

    if (this.moduleOwners.has(target)) {
      return this.moduleOwners.get(target);
    }

    return this.rootModule;
  }

  private assertAccessible(token: any, module?: any): void {
    if (module === undefined || BUILT_IN_TOKENS.has(token)) {
      return;
    }

    const owner = this.moduleOwners.get(token);
    if (owner === undefined || owner === module) {
      return;
    }

    const visibleTokens = this.moduleVisibleTokens.get(module);
    if (visibleTokens?.has(token)) {
      return;
    }

    throw new Error(
      `Provider ${this.describeToken(token)} is not visible inside module ${this.describeToken(module)}.`,
    );
  }

  private computeVisibleTokens(module: any, seen: Set<any>): Set<any> {
    const cached = this.moduleVisibleTokens.get(module);
    if (cached) {
      return cached;
    }

    if (seen.has(module)) {
      return new Set();
    }
    seen.add(module);

    const visible = new Set<any>(this.moduleOwnTokens.get(module) ?? []);
    for (const importedModule of this.moduleImports.get(module) ?? []) {
      for (const token of this.getExportedTokens(importedModule, seen)) {
        visible.add(token);
      }
    }

    for (const globalModule of this.globalModules) {
      if (globalModule === module) continue;
      for (const token of this.getExportedTokens(globalModule, seen)) {
        visible.add(token);
      }
    }

    this.moduleVisibleTokens.set(module, visible);
    seen.delete(module);
    return visible;
  }

  private getExportedTokens(module: any, seen: Set<any>): Set<any> {
    const exported = new Set<any>();
    for (const item of this.moduleRawExports.get(module) ?? []) {
      if (this.moduleImports.has(item)) {
        for (const token of this.getExportedTokens(item, seen)) {
          exported.add(token);
        }
        continue;
      }

      exported.add(isCustomProvider(item) ? item.provide : item);
    }
    return exported;
  }

  private addOwnedToken(module: any, token: any): void {
    const tokens = this.moduleOwnTokens.get(module) ?? new Set<any>();
    tokens.add(token);
    this.moduleOwnTokens.set(module, tokens);
  }

  private describeToken(token: any): string {
    return String(token?.name || token);
  }

  public hasContextualDeps(target: any): boolean {
    if (typeof target !== "function") return false;
    if (this.providers.has(target)) {
      return this.providerHasContextualDeps(this.providers.get(target)!);
    }
    return this.classHasContextualDeps(target);
  }

  private classHasContextualDeps(target: any, seen = new Set<any>()): boolean {
    if (typeof target !== "function" || seen.has(target)) return false;
    seen.add(target);

    let tokens = paramTypesCache.get(target);
    if (!tokens) {
      tokens = Reflect.getMetadata("design:paramtypes", target) ?? [];
      paramTypesCache.set(target, tokens!);
    }

    let injectTokens = injectTokensCache.get(target);
    if (!injectTokens) {
      injectTokens = Reflect.getMetadata(INJECT_METADATA, target) ?? {};
      injectTokensCache.set(target, injectTokens!);
    }

    return tokens!.some((token: any, index: number) => {
      const resolvedToken = injectTokens![index] !== undefined ? injectTokens![index] : token;
      if (resolvedToken === REQUEST || resolvedToken === INQUIRER) return true;
      if (this.providers.has(resolvedToken)) {
        const provider = this.providers.get(resolvedToken)!;
        return (
          getProviderScope(provider) === Scope.REQUEST ||
          this.providerHasContextualDeps(provider, seen)
        );
      }
      return (
        getClassScope(resolvedToken) === Scope.REQUEST ||
        this.classHasContextualDeps(resolvedToken, seen)
      );
    });
  }

  private providerHasContextualDeps(provider: Provider, seen = new Set<any>()): boolean {
    if (isClassProvider(provider)) {
      return this.classHasContextualDeps(provider.useClass, seen);
    }
    if (isExistingProvider(provider)) {
      return this.classHasContextualDeps(provider.useExisting, seen);
    }
    if (isFactoryProvider(provider)) {
      return (provider.inject || []).some((dep) => {
        if (dep === REQUEST || dep === INQUIRER) return true;
        if (this.providers.has(dep)) {
          const dependencyProvider = this.providers.get(dep)!;
          return (
            getProviderScope(dependencyProvider) === Scope.REQUEST ||
            this.providerHasContextualDeps(dependencyProvider, seen)
          );
        }
        return getClassScope(dep) === Scope.REQUEST || this.classHasContextualDeps(dep, seen);
      });
    }
    return false;
  }

  public reset(): void {
    this.instances.clear();
    this.requestInstances.clear();
    this.resolutionStack.clear();
    this.staticCache.clear();
    this.providers.clear();
    this.moduleImports.clear();
    this.moduleOwnTokens.clear();
    this.moduleRawExports.clear();
    this.moduleVisibleTokens.clear();
    this.moduleOwners.clear();
    this.globalModules.clear();
    this.rootModule = undefined;
    this.instances.set(Reflector, new Reflector());
    this.instances.set(ModuleRef, new ModuleRef(this));
  }
}

export const globalContainer = new Container();
