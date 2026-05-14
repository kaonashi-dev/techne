import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "../common/constants";
import { TechneApplicationContext } from "../core/application-context";
import type { CorsOptions, GlobalPrefixOptions, VersioningOptions } from "../core/http-options";
import { Scanner } from "../core/scanner";
import {
  Container,
  getClassScope,
  getProviderScope,
  isCustomProvider,
} from "../core/container";
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
  if (!base) return { ...(overrides ?? {}) };
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
}

export interface AppBootstrapConfig extends TechneApplicationOptions {
  controllers?: any[];
  providers?: any[];
  features?: Feature[];
  plugins?: PluginDefinition<any>[];
}

export class TechneFactory {
  public static async create(config: AppBootstrapConfig): Promise<TechneApplication>;
  public static async create(): Promise<TechneApplication>;
  public static async create(
    config?: AppBootstrapConfig,
  ): Promise<TechneApplication> {
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
      ...effectiveOptions
    } = merged as any;

    const loggerEnabled = effectiveOptions?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const logger = new Logger("TechneFactory");
    logger.log("Starting application initialization...");

    const container = effectiveOptions?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });

    scanner.scanFlat(this.flattenBootstrapConfig(merged));

    const adapter = new ElysiaAdapter({ logger: loggerEnabled, container });
    const routesResolver = new RoutesResolver(scanner);
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
        userOptions: (effectiveOptions ?? {}) as Record<string, unknown>,
      },
    );

    for (const plugin of plugins) {
      await app.register(plugin);
    }

    this.initializeStaticProviders(scanner, container, loggerEnabled);
    await scanner.callLifecycleHook("onModuleInit");

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    if (container.has(MQ_DRIVER)) {
      const mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
      app.attachMqRegistry(mqRegistry);
    }

    const globalGuards = [
      ...this.normalizeGlobalProvider<CanActivate | Function>(container, APP_GUARD),
      ...(effectiveOptions?.globalGuards ?? []),
    ];
    const globalFilters = this.normalizeGlobalProvider(container, APP_FILTER);
    const globalInterceptors = this.normalizeGlobalProvider(container, APP_INTERCEPTOR);
    const globalPipes = this.normalizeGlobalProvider(container, APP_PIPE);

    if (globalGuards.length > 0) {
      routesResolver.executionContext.setGlobalGuards(globalGuards);
    }
    if (globalFilters.length > 0) {
      routesResolver.executionContext.setGlobalFilters(globalFilters as any);
    }
    if (globalInterceptors.length > 0) {
      routesResolver.executionContext.setGlobalInterceptors(globalInterceptors as any);
    }
    if (globalPipes.length > 0) {
      routesResolver.executionContext.setGlobalPipes(globalPipes as any);
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
    const loggerEnabled = config?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const container = config?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });
    scanner.scanFlat(this.flattenBootstrapConfig(config));

    const adapter = new ElysiaAdapter({ logger: loggerEnabled, container });
    const routesResolver = new RoutesResolver(scanner);
    const pluginApp = new TechneApplication(
      adapter,
      scanner,
      container,
      routesResolver,
      routesResolver.executionContext,
      undefined,
      { userOptions: config as Record<string, unknown> },
    );

    for (const plugin of config.plugins ?? []) {
      await pluginApp.register(plugin);
    }

    this.initializeStaticProviders(scanner, container, loggerEnabled);
    await scanner.callLifecycleHook("onModuleInit");

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    let mqRegistry: MqRegistry | undefined;
    if (container.has(MQ_DRIVER)) {
      mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
    }

    return new TechneApplicationContext(scanner, container, mqRegistry).init();
  }

  private static flattenBootstrapConfig(config: AppBootstrapConfig): {
    controllers?: any[];
    providers?: any[];
  } {
    return {
      controllers: [
        ...(config.controllers ?? []),
        ...(config.features ?? []).flatMap((feature) => feature.controllers ?? []),
      ],
      providers: [
        ...(config.providers ?? []),
        ...(config.features ?? []).flatMap((feature) => feature.providers ?? []),
      ],
    };
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
