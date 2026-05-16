import { APP_FILTER, APP_GUARD } from "../common/constants";
import { resolveTechneMode, type TechneMode } from "../common/mode";
import { TechneApplicationContext } from "../core/application-context";
import type { CorsOptions, GlobalPrefixOptions, VersioningOptions } from "../core/http-options";
import { Scanner } from "../core/scanner";
import { Container, getClassScope, getProviderScope, isCustomProvider } from "../core/container";
import { Scope } from "../core/scope";
import { RoutesResolver } from "../core/router/routes-resolver";
import { ElysiaAdapter } from "../platform/elysia-adapter";
import { Logger } from "../services/logger.service";
import { BusRegistry } from "../cqrs/bus";
import { TechneApplication } from "../core/techne-application";
import { MqRegistry } from "../mq/registry";
import { MQ_DRIVER } from "../mq/tokens";
import type { CanActivate } from "../interfaces/can-activate.interface";
import type { TechneConfig } from "../core/define-techne-config";
import type { Feature } from "../core/define-feature";
import type { PluginDefinition } from "../core/plugins/define-plugin";
import { loadPrecompiledRoutesForScanner } from "../cli/precompile";

/**
 * Config file lookup order: `techne.config.{ts,js,mjs}` is canonical;
 * `bnest.config.{ts,js,mjs}` is a deprecated fallback retained through v0.4.x
 * and removed in v0.5+. Matching the legacy name emits a one-time warning.
 */
const TECHNE_CONFIG_CANDIDATES = [
  "techne.config.ts",
  "techne.config.js",
  "techne.config.mjs",
] as const;
const LEGACY_BNEST_CONFIG_CANDIDATES = [
  "bnest.config.ts",
  "bnest.config.js",
  "bnest.config.mjs",
] as const;
const cwdCache = new Map<string, TechneConfig | null>();
let warnedLegacyConfig = false;

/**
 * Loads the framework config from `process.cwd()` if present.
 * Tries `techne.config.{ts,js,mjs}` first, then the deprecated
 * `bnest.config.{ts,js,mjs}`. Results are cached per cwd; tests that swap
 * directories between cases should call {@link __resetTechneConfigCache}.
 */
export async function loadTechneConfigFile(): Promise<TechneConfig | null> {
  const cwd = process.cwd();
  if (cwdCache.has(cwd)) return cwdCache.get(cwd) ?? null;
  for (const name of TECHNE_CONFIG_CANDIDATES) {
    const filePath = `${cwd}/${name}`;
    if (!(await Bun.file(filePath).exists())) continue;
    const mod = await import(filePath);
    if (!mod || mod.default === undefined) {
      throw new Error(
        `Found ${name} but it has no default export. Use \`export default defineTechneConfig({...})\`.`,
      );
    }
    const value = mod.default as TechneConfig;
    cwdCache.set(cwd, value);
    return value;
  }
  for (const name of LEGACY_BNEST_CONFIG_CANDIDATES) {
    const filePath = `${cwd}/${name}`;
    if (!(await Bun.file(filePath).exists())) continue;
    if (!warnedLegacyConfig) {
      warnedLegacyConfig = true;
      new Logger("TechneFactory").warn(
        `Found ${name}; rename to ${name.replace("bnest.", "techne.")} (legacy name removed in v0.5).`,
      );
    }
    const mod = await import(filePath);
    if (!mod || mod.default === undefined) {
      throw new Error(
        `Found ${name} but it has no default export. Use \`export default defineTechneConfig({...})\`.`,
      );
    }
    const value = mod.default as TechneConfig;
    cwdCache.set(cwd, value);
    return value;
  }
  cwdCache.set(cwd, null);
  return null;
}

/**
 * Test/internal hook: clears the cached config resolution so the next call
 * re-reads the file. Tests that swap `cwd` between cases need this. Also
 * resets the one-time legacy-config warning latch.
 */
export function __resetTechneConfigCache() {
  cwdCache.clear();
  warnedLegacyConfig = false;
}

function mergeConfig(
  base: TechneConfig | null,
  overrides?: AppBootstrapConfig,
): AppBootstrapConfig & { port?: number; host?: string } {
  if (!base && !overrides) return {};
  if (!base) return { ...overrides };
  if (!overrides) return { ...base };
  // Shallow merge per top-level key. `globalGuards` is the only field that
  // concatenates so config-declared guards stay attached when callers add more.
  const merged: any = { ...base, ...overrides };
  const baseGuards = base.globalGuards ?? [];
  const overrideGuards = overrides.globalGuards ?? [];
  if (baseGuards.length || overrideGuards.length) {
    merged.globalGuards = [...baseGuards, ...overrideGuards];
  }
  return merged;
}

export interface TechneShutdownOptions {
  /** ms to wait for in-flight requests before forcing shutdown. Default: 10_000 */
  gracePeriod?: number;
  /** Signals that should trigger graceful shutdown. Default: ["SIGTERM", "SIGINT"] */
  signals?: ("SIGTERM" | "SIGINT" | "SIGHUP")[];
}

export interface TechneHealthOptions {
  /** Enable auto-registered health endpoints. Default: true */
  enabled?: boolean;
  /** Path for liveness probe (always 200 once the process is up). Default: "/healthz" */
  livenessPath?: string;
  /** Path for readiness probe. Default: "/readyz" */
  readinessPath?: string;
  /** Custom checks to evaluate when serving the readiness endpoint. */
  checks?: Array<() => Promise<{ healthy: boolean; name: string; detail?: any }>>;
}

export interface TechneApplicationOptions {
  logger?: boolean | string[];
  container?: Container;
  validateResponses?: boolean;
  /**
   * Guards to apply globally to every route. Because guards are wired into
   * Elysia's `beforeHandle` at registration time, providing them here is the
   * reliable way to ensure they apply to every route. Calling
   * `app.useGlobalGuards()` after `TechneFactory.create()` only applies to
   * routes registered after the call.
   */
  globalGuards?: (CanActivate | Function)[];
  globalPrefix?: string;
  globalPrefixOptions?: GlobalPrefixOptions;
  versioning?: VersioningOptions;
  cors?: CorsOptions;
  /**
   * Graceful shutdown configuration. When the configured signals fire, the
   * adapter begins refusing new requests with HTTP 503 and waits up to
   * `gracePeriod` ms for in-flight work to settle before stopping.
   */
  shutdown?: TechneShutdownOptions;
  /**
   * Auto-registered health endpoints. Disable by setting `enabled: false`.
   * Liveness returns 200 once the process is up; readiness returns 200 only
   * after `onApplicationBootstrap` completes and every configured check
   * reports `healthy: true`.
   */
  health?: TechneHealthOptions;
  /**
   * Request-body / params / query validation behavior.
   *
   * By default, a validation failure returns a single-entry `errors` array
   * containing the first reported error. Set `exhaustive: true` to return
   * every error TypeBox reports (this materializes the full TypeBox iterator
   * on every invalid request and is significantly slower; opt in only when
   * clients need all errors at once).
   */
  validation?: TechneValidationOptions;
}

export interface TechneValidationOptions {
  /**
   * When `true`, the validation error response includes every error reported
   * by the schema. When omitted/`false` (default), only the first error is
   * returned.
   *
   * The wire shape (`errors: [...]`) is unchanged — the default response just
   * carries a single-element array instead of the full set.
   */
  exhaustive?: boolean;
}

export interface AppBootstrapConfig extends TechneApplicationOptions {
  controllers?: any[];
  providers?: any[];
  features?: Feature[];
  plugins?: PluginDefinition<any>[];
  /**
   * Determines which subsystems start. Defaults to `"all"`.
   * Can also be set via the `TECHNE_MODE` environment variable;
   * an explicit `mode` here takes precedence over the env var.
   *
   * - `"all"` — HTTP server + MQ workers (current default behavior).
   * - `"server"` — HTTP only; MQ queues are DI-injectable for publishing but
   *   no workers are started.
   * - `"worker"` — MQ workers only; `listen()` is a no-op for HTTP so the
   *   process stays alive via worker event loops.
   */
  mode?: TechneMode;
}

export class TechneFactory {
  public static async create(config: AppBootstrapConfig): Promise<TechneApplication>;
  public static async create(): Promise<TechneApplication>;
  public static async create(config?: AppBootstrapConfig): Promise<TechneApplication> {
    const fileConfig = await loadTechneConfigFile();
    if (!config && !fileConfig) {
      throw new Error(
        "TechneFactory.create(): no config supplied and no `techne.config.ts` found.",
      );
    }

    const merged = mergeConfig(fileConfig, config);
    const {
      port: _p,
      host: _h,
      controllers: _c,
      providers: _pv,
      features: _f,
      plugins = [],
      mode: modeOption,
      ...effectiveOptions
    } = merged as any;

    const mode = resolveTechneMode(modeOption);
    const loggerEnabled = effectiveOptions?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const logger = new Logger("TechneFactory");
    logger.log("Starting application initialization...");

    const container = effectiveOptions?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });

    scanner.scanFlat(this.flattenBootstrapConfig(merged));

    const adapter = new ElysiaAdapter({
      logger: loggerEnabled,
      container,
      shutdown: effectiveOptions?.shutdown,
      validation: effectiveOptions?.validation,
      // Techne always wires the RFC 7807 problem-document filter via
      // `RouterResponseController.mapException`, which reads
      // `ctx.store.requestId` for the `requestId` extension field. Flag it
      // so the adapter keeps the request-id hook registered even when
      // request logging is off.
      hasProblemFilter: true,
      requestId: (effectiveOptions as { requestId?: boolean })?.requestId,
    });
    const precompiledRoutes = config
      ? undefined
      : await loadPrecompiledRoutesForScanner(scanner, process.cwd(), logger);
    const routesResolver = new RoutesResolver(scanner, precompiledRoutes);
    routesResolver.executionContext.setValidateResponses(
      effectiveOptions?.validateResponses === true,
    );
    const app = new TechneApplication(
      adapter,
      scanner,
      container,
      routesResolver,
      routesResolver.executionContext,
      undefined,
      {
        shutdown: effectiveOptions?.shutdown,
        health: effectiveOptions?.health,
        mode,
        userOptions: (effectiveOptions ?? {}) as Record<string, unknown>,
      },
    );

    await this.registerPluginsPhased(app, plugins);

    this.initializeStaticProviders(scanner, container, loggerEnabled);
    await scanner.callLifecycleHook("onModuleInit");

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    if (container.has(MQ_DRIVER)) {
      const mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      if (mode !== "server") {
        mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
      }
      app.attachMqRegistry(mqRegistry);
    }

    const globalGuards = [
      ...this.normalizeGlobalProvider<CanActivate | Function>(container, APP_GUARD),
      ...(effectiveOptions?.globalGuards ?? []),
    ];
    const globalFilters = this.normalizeGlobalProvider(container, APP_FILTER);

    if (globalGuards.length > 0) {
      routesResolver.executionContext.setGlobalGuards(globalGuards);
    }
    if (globalFilters.length > 0) {
      routesResolver.executionContext.setGlobalFilters(globalFilters as any);
    }

    if (effectiveOptions?.cors) {
      app.applyCorsFromConfig(effectiveOptions.cors);
    }

    app.initializeRoutes({
      globalPrefix: effectiveOptions?.globalPrefix
        ? {
            prefix: effectiveOptions.globalPrefix,
            exclude: effectiveOptions.globalPrefixOptions?.exclude,
          }
        : undefined,
      versioning: effectiveOptions?.versioning,
    });

    const factoryLogger = new Logger("TechneFactory");
    factoryLogger.log("Dependencies initialized");
    factoryLogger.log(`Mapped ${app.getRoutes().length} routes`);

    return app;
  }

  public static async createApplicationContext(
    config: AppBootstrapConfig,
  ): Promise<TechneApplicationContext> {
    const mode = resolveTechneMode(config?.mode);
    const loggerEnabled = config?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const container = config?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });
    scanner.scanFlat(this.flattenBootstrapConfig(config));

    const adapter = new ElysiaAdapter({
      logger: loggerEnabled,
      container,
      validation: config?.validation,
      hasProblemFilter: true,
    });
    const routesResolver = new RoutesResolver(scanner);
    const pluginApp = new TechneApplication(
      adapter,
      scanner,
      container,
      routesResolver,
      routesResolver.executionContext,
      undefined,
      { mode, userOptions: config as Record<string, unknown> },
    );

    await this.registerPluginsPhased(pluginApp, config.plugins ?? []);

    this.initializeStaticProviders(scanner, container, loggerEnabled);
    await scanner.callLifecycleHook("onModuleInit");

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    let mqRegistry: MqRegistry | undefined;
    if (container.has(MQ_DRIVER)) {
      mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      if (mode !== "server") {
        mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
      }
    }

    return new TechneApplicationContext(scanner, container, mqRegistry).init();
  }

  /**
   * Register plugins partitioned by their `ready` phase. The default
   * `"before-routes"` phase runs here (before routes are mapped) so plugins
   * that influence routing still apply. The `"before-listen"` phase is
   * queued onto the app and flushed at the start of `listen()` — those
   * plugins fan out concurrently via `Promise.all`.
   *
   * Within the `"before-routes"` phase we still need a topo sort because
   * existing plugins may declare `dependencies`. Plugins without
   * inter-dependencies in this phase init concurrently (Kahn's algorithm in
   * layers). When no plugin opts into the new fields this matches the
   * previous sequential behavior: each plugin lands in its own layer in
   * declaration order via the dependency graph.
   */
  private static async registerPluginsPhased(
    app: TechneApplication,
    plugins: PluginDefinition<any>[],
  ): Promise<void> {
    if (plugins.length === 0) return;

    // Partition once. Order is preserved within each phase — important for
    // back-compat (declaration order is the tiebreaker for the topo sort).
    const beforeRoutes: PluginDefinition<any>[] = [];
    for (const plugin of plugins) {
      const phase = plugin.ready ?? "before-routes";
      if (phase === "before-listen") {
        app.enqueueBeforeListenPlugin(plugin);
      } else {
        beforeRoutes.push(plugin);
      }
    }

    if (beforeRoutes.length === 0) return;

    // Fast-path: if no plugin in this phase declares a dependency, run them
    // sequentially in declaration order to preserve the historical guarantee
    // that `register()` resolves in the same order callers wrote.
    let anyDep = false;
    for (const p of beforeRoutes) {
      if (p.dependencies && p.dependencies.length > 0) {
        anyDep = true;
        break;
      }
    }
    if (!anyDep) {
      for (const plugin of beforeRoutes) {
        await app.register(plugin);
      }
      return;
    }

    // Topo sort via Kahn's algorithm. Each layer's plugins have all their
    // intra-phase deps satisfied and run concurrently.
    const byName = new Map<string, PluginDefinition<any>>();
    for (const p of beforeRoutes) byName.set(p.name, p);
    const remaining = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const p of beforeRoutes) {
      let count = 0;
      for (const dep of p.dependencies ?? []) {
        if (byName.has(dep)) {
          count++;
          const list = dependents.get(dep);
          if (list) list.push(p.name);
          else dependents.set(dep, [p.name]);
        }
        // Deps outside this phase fall through to `register()`'s own check,
        // which throws if the dep was never registered at all.
      }
      remaining.set(p.name, count);
    }

    let layer: PluginDefinition<any>[] = [];
    for (const p of beforeRoutes) {
      if ((remaining.get(p.name) ?? 0) === 0) layer.push(p);
    }

    let processed = 0;
    while (layer.length > 0) {
      await Promise.all(layer.map((plugin) => app.register(plugin)));
      processed += layer.length;
      const next: PluginDefinition<any>[] = [];
      for (const p of layer) {
        for (const dependentName of dependents.get(p.name) ?? []) {
          const count = (remaining.get(dependentName) ?? 0) - 1;
          remaining.set(dependentName, count);
          if (count === 0) {
            const entry = byName.get(dependentName);
            if (entry) next.push(entry);
          }
        }
      }
      layer = next;
    }

    if (processed !== beforeRoutes.length) {
      const stuck: string[] = [];
      for (const [name, count] of remaining) {
        if (count > 0) stuck.push(name);
      }
      throw new Error(`Cyclic plugin dependency detected among: ${stuck.join(", ")}.`);
    }
  }

  private static flattenBootstrapConfig(config: AppBootstrapConfig): {
    controllers?: any[];
    providers?: any[];
  } {
    const baseControllers = config.controllers;
    const baseProviders = config.providers;
    const features = config.features;

    // Single pass over features: accumulate controllers and providers
    // together instead of running `flatMap` once per list (which walked
    // `features` twice and allocated an intermediate array each time).
    const controllers: any[] = baseControllers ? baseControllers.slice() : [];
    const providers: any[] = baseProviders ? baseProviders.slice() : [];

    if (features) {
      for (const feature of features) {
        const fc = feature.controllers;
        if (fc) {
          for (const c of fc) controllers.push(c);
        }
        const fp = feature.providers;
        if (fp) {
          for (const p of fp) providers.push(p);
        }
      }
    }

    return { controllers, providers };
  }

  private static initializeStaticProviders(
    scanner: Scanner,
    container: Container,
    loggerEnabled: boolean,
  ): void {
    const logger = new Logger("TechneFactory");
    for (const provider of scanner.getProviders()) {
      if (isCustomProvider(provider)) {
        const token = (provider as any).provide;
        if (loggerEnabled) {
          logger.debug(`Initializing provider ${String(token?.name || token)}`);
        }
        if (getProviderScope(provider) === Scope.DEFAULT && container.isStatic(token)) {
          container.get(token);
        }
      } else {
        if (loggerEnabled) {
          logger.debug(`Initializing provider ${provider.name || "UnknownProvider"}`);
        }
        if (getClassScope(provider) === Scope.DEFAULT && container.isStatic(provider)) {
          container.get(provider);
        }
      }
    }
    // C4: snapshot static+cached entries so warm-path resolve becomes a
    // single Map.get.
    container.primeFastTable();
  }

  private static normalizeGlobalProvider<T>(container: Container, token: any): T[] {
    if (!container.has(token)) return [];

    const provider = container.getProviderDefinition(token);
    if (provider && !container.isStatic(token)) {
      if ("useClass" in provider) {
        return [provider.useClass];
      }
      if ("useExisting" in provider) {
        return [provider.useExisting];
      }
      throw new Error(
        `Global provider ${String(token)} uses a contextual factory that cannot be materialized at bootstrap.`,
      );
    }

    const resolved = container.get<T | T[]>(token);
    return Array.isArray(resolved) ? resolved : [resolved];
  }
}

// ─── Deprecated Bnest aliases (kept through v0.4.x; removed in v0.5+) ───
/** @deprecated use TechneFactory */
export { TechneFactory as BnestFactory };
/** @deprecated use TechneApplicationOptions */
export type BnestApplicationOptions = TechneApplicationOptions;
/** @deprecated use TechneHealthOptions */
export type BnestHealthOptions = TechneHealthOptions;
/** @deprecated use TechneShutdownOptions */
export type BnestShutdownOptions = TechneShutdownOptions;
/** @deprecated use loadTechneConfigFile */
export const loadBnestConfigFile = loadTechneConfigFile;
/** @deprecated use __resetTechneConfigCache */
export const __resetBnestConfigCache = __resetTechneConfigCache;
