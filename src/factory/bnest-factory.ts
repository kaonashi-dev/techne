import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "../common/constants";
import { BnestApplicationContext } from "../core/application-context";
import type { CorsOptions, GlobalPrefixOptions, VersioningOptions } from "../core/http-options";
import { Scanner } from "../core/scanner";
import { Container } from "../core/container";
import { RoutesResolver } from "../core/router/routes-resolver";
import { ElysiaAdapter } from "../platform/elysia-adapter";
import { Logger } from "../services/logger.service";
import { BusRegistry } from "../cqrs/bus";
import { BnestApplication } from "../core/bnest-application";
import { MicroservicesAdapter } from "../microservices/adapter";
import type { MicroserviceOptions } from "../microservices/types";
import { MqRegistry } from "../mq/registry";
import { MQ_DRIVER } from "../mq/tokens";
import type { CanActivate } from "../interfaces/can-activate.interface";

export interface BnestShutdownOptions {
  /** ms to wait for in-flight requests before forcing shutdown. Default: 10_000 */
  gracePeriod?: number;
  /** Signals that should trigger graceful shutdown. Default: ["SIGTERM", "SIGINT"] */
  signals?: ("SIGTERM" | "SIGINT" | "SIGHUP")[];
}

export interface BnestHealthOptions {
  /** Enable auto-registered health endpoints. Default: true */
  enabled?: boolean;
  /** Path for liveness probe (always 200 once the process is up). Default: "/healthz" */
  livenessPath?: string;
  /** Path for readiness probe. Default: "/readyz" */
  readinessPath?: string;
  /** Custom checks to evaluate when serving the readiness endpoint. */
  checks?: Array<() => Promise<{ healthy: boolean; name: string; detail?: any }>>;
}

export interface BnestApplicationOptions {
  logger?: boolean | string[];
  container?: Container;
  /**
   * Guards to apply globally to every route. Because guards are wired into
   * Elysia's `beforeHandle` at registration time, providing them here is the
   * reliable way to ensure they apply to every route. Calling
   * `app.useGlobalGuards()` after `BnestFactory.create()` only applies to
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
  shutdown?: BnestShutdownOptions;
  /**
   * Auto-registered health endpoints. Disable by setting `enabled: false`.
   * Liveness returns 200 once the process is up; readiness returns 200 only
   * after `onApplicationBootstrap` completes and every configured check
   * reports `healthy: true`.
   */
  health?: BnestHealthOptions;
}

export class BnestFactory {
  public static async create(
    module: any,
    options?: BnestApplicationOptions,
  ): Promise<BnestApplication> {
    const loggerEnabled = options?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const logger = new Logger("BnestFactory");
    logger.log("Starting application initialization...");

    const container = options?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });
    await scanner.scan(module);
    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    let mqRegistry: MqRegistry | undefined;
    if (container.has(MQ_DRIVER)) {
      mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
    }

    const adapter = new ElysiaAdapter({ logger: loggerEnabled, container });
    const routesResolver = new RoutesResolver(scanner);
    const app = new BnestApplication(
      adapter,
      scanner,
      container,
      routesResolver,
      routesResolver.executionContext,
      mqRegistry,
      { shutdown: options?.shutdown, health: options?.health },
    );

    const globalGuards = [
      ...this.normalizeGlobalProvider<CanActivate | Function>(container, APP_GUARD),
      ...(options?.globalGuards ?? []),
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

    if (options?.cors) {
      app.enableCors(options.cors);
    }

    app.initializeRoutes({
      globalPrefix: options?.globalPrefix
        ? {
            prefix: options.globalPrefix,
            exclude: options.globalPrefixOptions?.exclude,
          }
        : undefined,
      versioning: options?.versioning,
    });

    logger.log("Dependencies initialized");
    logger.log(`Mapped ${app.getRoutes().length} routes`);

    return app;
  }

  public static async createMicroservice(module: any, options: MicroserviceOptions) {
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    await scanner.scan(module);

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    if (container.has(MQ_DRIVER)) {
      const mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
    }

    const adapter = new MicroservicesAdapter(container);
    return adapter.create([...scanner.getProviders(), ...scanner.getControllers()], options);
  }

  public static async createApplicationContext(
    module: any,
    options?: Pick<BnestApplicationOptions, "container" | "logger">,
  ): Promise<BnestApplicationContext> {
    const loggerEnabled = options?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const container = options?.container || new Container();
    const scanner = new Scanner({ logger: loggerEnabled, container });
    await scanner.scan(module);

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    let mqRegistry: MqRegistry | undefined;
    if (container.has(MQ_DRIVER)) {
      mqRegistry = new MqRegistry(container, container.get(MQ_DRIVER));
      mqRegistry.register();
      mqRegistry.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);
    }

    return new BnestApplicationContext(scanner, container, mqRegistry).init();
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

    const resolved = container.get<T | T[]>(token, {
      module: container.getRootModule(),
    });
    return Array.isArray(resolved) ? resolved : [resolved];
  }
}
