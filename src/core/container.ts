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
  request?: any;
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

const paramTypesCache = new Map<Function, any[]>();
const injectTokensCache = new Map<Function, Record<number, any>>();

export class Container {
  private instances = new Map<any, any>();
  private requestInstances = new Map<symbol, Map<any, any>>();
  private requestContextIds = new WeakMap<object, symbol>();
  private resolutionStack = new Set<any>();
  private staticCache = new Map<any, boolean>();
  private providers = new Map<any, Provider>();
  // C4: warm-path fast table. Holds only static-scoped + already-materialized
  // instances. `get(token)` short-circuits to a single Map.get on hit.
  // Invariant: every entry here must also live in `this.instances` and
  // `isStatic(token)` must hold. Mutations to providers/instances delete
  // the affected token from the table. Lazily repopulated on resolve().
  private fastTable = new Map<any, any>();

  constructor() {
    this.instances.set(Reflector, new Reflector());
    this.instances.set(ModuleRef, new ModuleRef(this));
    // Reflector is a static singleton; safe to seed.
    // ModuleRef intentionally NOT seeded: resolve() returns a fresh
    // ModuleRef per call (see ModuleRef branch in resolve()), so keeping
    // it out of fastTable preserves that behavior.
    this.fastTable.set(Reflector, this.instances.get(Reflector));
  }

  public set<T>(token: any, value: T): void {
    this.instances.set(token, value);
    // Drop any prior snapshot for this token; get() will lazily re-add
    // if subsequent resolution proves the entry is static.
    this.fastTable.delete(token);
  }

  public has(token: any): boolean {
    return this.instances.has(token) || this.providers.has(token);
  }

  public getProviderDefinition(token: any): Provider | undefined {
    return this.providers.get(token);
  }

  public addProvider(provider: Provider): void {
    this.providers.set(provider.provide, provider);
    this.staticCache.delete(provider.provide);
    this.fastTable.delete(provider.provide);
  }

  public registerController(controller: any): void {
    this.staticCache.delete(controller);
    this.fastTable.delete(controller);
  }

  /**
   * Walk every known token and snapshot static, already-cached entries into
   * `fastTable`. Intended to run after `initializeStaticProviders` so the
   * warm-path `get()` becomes a single `Map.get`. Idempotent; safe to call
   * multiple times. Never inserts request/transient/contextual entries.
   */
  public primeFastTable(): void {
    // Seed from provider definitions whose instances are already cached.
    for (const token of this.providers.keys()) {
      if (this.instances.has(token) && this.isStatic(token)) {
        const inst = this.instances.get(token);
        if (inst !== undefined) this.fastTable.set(token, inst);
      }
    }
    // Seed from already-instantiated classes (no custom provider).
    for (const [token, inst] of this.instances) {
      if (this.fastTable.has(token)) continue;
      // ModuleRef must stay out — resolve() returns a fresh one per call.
      if (token === ModuleRef) continue;
      // Non-class tokens registered only via `set()` have ambiguous scope.
      // Leave them out; get() backfills lazily once their static-ness is
      // confirmed against the provider/class metadata.
      if (typeof token !== "function") continue;
      if (inst === undefined) continue;
      if (this.isStatic(token)) {
        this.fastTable.set(token, inst);
      }
    }
  }

  public get<T>(target: any): T {
    // Warm-path: single Map.get. Map.get returning undefined falls through
    // to the full resolution ladder so `useValue: undefined` and missing
    // entries both still take the correct path.
    const hit = this.fastTable.get(target);
    if (hit !== undefined) return hit as T;
    const resolved = this.resolve<T>(target);
    // Backfill: if this turned out to be a static, cached entry, promote
    // it so subsequent calls are fast. Skip undefined values, REQUEST /
    // INQUIRER (never static), and ModuleRef (returns fresh per call).
    if (
      resolved !== undefined &&
      target !== REQUEST &&
      target !== INQUIRER &&
      target !== ModuleRef &&
      this.instances.has(target) &&
      this.isStatic(target)
    ) {
      this.fastTable.set(target, resolved);
    }
    return resolved;
  }

  public createContextId(): symbol {
    return Symbol("techne:context");
  }

  public clearContext(contextIdOrRequest: symbol | object): void {
    if (typeof contextIdOrRequest === "symbol") {
      this.requestInstances.delete(contextIdOrRequest);
      return;
    }

    const contextId = this.requestContextIds.get(contextIdOrRequest);
    if (!contextId) return;
    this.requestInstances.delete(contextId);
    this.requestContextIds.delete(contextIdOrRequest);
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
    if (target === REQUEST) {
      return context.request as T;
    }

    if (target === INQUIRER) {
      return context.inquirer as T;
    }

    if (target === ModuleRef) {
      return new ModuleRef(this) as T;
    }

    if (this.providers.has(target)) {
      return this.resolveProvider<T>(target, context);
    }

    if (typeof target !== "function") {
      throw new Error(
        `Cannot resolve token: ${String(target)}. No provider registered and it's not a class.`,
      );
    }

    if (this.instances.has(target)) {
      return this.instances.get(target);
    }

    const scope = getClassScope(target);
    if (scope === Scope.REQUEST) {
      const contextId = this.getResolutionContextId(context);
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
      const contextId = this.getResolutionContextId(context);
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

      const injections = tokens!.map((token: any, index: number) => {
        const resolvedToken = injectTokens![index] !== undefined ? injectTokens![index] : token;
        return this.resolve(resolvedToken, {
          contextId: context.contextId,
          request: context.request,
          inquirer: target,
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
      const contextId = this.getResolutionContextId(context);
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
      const contextId = this.getResolutionContextId(context);
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
      if (provider.useClass === provider.provide) {
        return this.instantiateClass<T>(provider.useClass, context);
      }
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

  private getResolutionContextId(context: ResolutionContext): symbol | undefined {
    if (context.contextId) return context.contextId;
    const request = context.request;
    if (!request || (typeof request !== "object" && typeof request !== "function")) {
      return undefined;
    }

    let contextId = this.requestContextIds.get(request);
    if (!contextId) {
      contextId = this.createContextId();
      this.requestContextIds.set(request, contextId);
    }
    context.contextId = contextId;
    return contextId;
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
    this.requestContextIds = new WeakMap<object, symbol>();
    this.resolutionStack.clear();
    this.staticCache.clear();
    this.providers.clear();
    this.fastTable.clear();
    this.instances.set(Reflector, new Reflector());
    this.instances.set(ModuleRef, new ModuleRef(this));
    this.fastTable.set(Reflector, this.instances.get(Reflector));
  }
}

export const globalContainer = new Container();
