import type { Scanner } from "./scanner";
import type { Container, ResolutionContext } from "./container";
import type { RouterExecutionContext } from "./router/router-execution-context";
import type { CanActivate } from "../interfaces/can-activate.interface";
import type { ExceptionFilter } from "../interfaces/exception-filter.interface";
import type { BnestInterceptor } from "../interfaces/interceptor.interface";
import type { PipeTransform } from "../interfaces/pipe-transform.interface";
import { Logger } from "../services/logger.service";
import type { MqRegistry } from "../mq/registry";
import type {
  CorsOptions,
  GlobalPrefixOptions,
  RouteRegistrationOptions,
  VersioningOptions,
} from "./http-options";
import type { ElysiaAdapter } from "../platform/elysia-adapter";
import type { RoutesResolver } from "./router/routes-resolver";
import type { CompiledRouteDefinition } from "./router/router-execution-context";

export type ShutdownSignal = "SIGTERM" | "SIGINT" | "SIGHUP";

export interface ShutdownOptions {
  gracePeriod: number;
  signals: ShutdownSignal[];
}

export interface HealthCheckFn {
  (): Promise<{ healthy: boolean; name: string; detail?: any }>;
}

export interface HealthOptions {
  enabled: boolean;
  livenessPath: string;
  readinessPath: string;
  checks: HealthCheckFn[];
}

export interface ReadinessReport {
  ready: boolean;
  checks: Array<{ name: string; healthy: boolean; detail?: any }>;
}

interface BnestApplicationInternalOptions {
  shutdown?: Partial<ShutdownOptions>;
  health?: Partial<HealthOptions>;
}

const DEFAULT_SHUTDOWN: ShutdownOptions = {
  gracePeriod: 10_000,
  signals: ["SIGTERM", "SIGINT"],
};

const DEFAULT_HEALTH: HealthOptions = {
  enabled: true,
  livenessPath: "/healthz",
  readinessPath: "/readyz",
  checks: [],
};

export class BnestApplication {
  private logger = new Logger("BnestApplication");
  private shutdownHandlers: { signal: ShutdownSignal; handler: () => void }[] = [];
  private isShuttingDown = false;
  private isReady = false;
  private routeOptions: RouteRegistrationOptions = {};
  private compiledRoutes: CompiledRouteDefinition[] = [];
  private routesInitialized = false;
  private readonly shutdownOptions: ShutdownOptions;
  private readonly healthOptions: HealthOptions;

  constructor(
    private readonly adapter: ElysiaAdapter,
    private readonly scanner: Scanner,
    private readonly container: Container,
    private readonly routesResolver: RoutesResolver,
    private readonly executionContext?: RouterExecutionContext,
    private readonly mqRegistry?: MqRegistry,
    options?: BnestApplicationInternalOptions,
  ) {
    this.shutdownOptions = {
      ...DEFAULT_SHUTDOWN,
      ...(options?.shutdown ?? {}),
    };
    this.healthOptions = {
      ...DEFAULT_HEALTH,
      ...(options?.health ?? {}),
      checks: options?.health?.checks ?? DEFAULT_HEALTH.checks,
    };
  }

  useGlobalFilters(...filters: ExceptionFilter[]): this {
    this.executionContext?.setGlobalFilters(filters);
    return this;
  }

  useGlobalInterceptors(...interceptors: BnestInterceptor[]): this {
    this.executionContext?.setGlobalInterceptors(interceptors);
    return this;
  }

  useGlobalPipes(...pipes: PipeTransform[]): this {
    this.executionContext?.setGlobalPipes(pipes);
    return this;
  }

  useGlobalGuards(...guards: (CanActivate | Function)[]): this {
    const appliedInTime = this.executionContext?.setGlobalGuards(guards) ?? false;
    if (!appliedInTime) {
      this.logger.warn(
        "useGlobalGuards() was called after routes were registered — only routes registered after this call will receive the new guards. Pass `globalGuards` to BnestFactory.create() for retroactive application.",
      );
    }
    return this;
  }

  setGlobalPrefix(prefix: string, options: GlobalPrefixOptions = {}): this {
    this.routeOptions.globalPrefix = { prefix, exclude: options.exclude };
    this.refreshRoutesIfInitialized();
    return this;
  }

  enableVersioning(options: VersioningOptions): this {
    this.routeOptions.versioning = options;
    this.refreshRoutesIfInitialized();
    return this;
  }

  enableCors(options: CorsOptions = {}): this {
    this.adapter.enableCors(options);
    this.refreshRoutesIfInitialized();
    return this;
  }

  async listen(port: number, callback?: () => void) {
    this.registerShutdownHandlers();
    // Fire bootstrap BEFORE accepting traffic so the app isn't reachable
    // until every onApplicationBootstrap hook has resolved.
    await this.scanner.callLifecycleHook("onApplicationBootstrap");
    this.isReady = true;
    this.adapter.getInstance().listen(port, callback);
    return this;
  }

  async close() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.isReady = false;

    this.logger.log("Shutting down...");
    this.adapter.setDraining(true);

    const startInflight = this.adapter.getInflightCount();
    const drained = await this.adapter.waitForDrain(this.shutdownOptions.gracePeriod);
    if (drained) {
      this.logger.log(`Drained ${startInflight} in-flight request(s)`);
    } else {
      this.logger.warn(
        `Forced shutdown after ${this.shutdownOptions.gracePeriod}ms, ${this.adapter.getInflightCount()} request(s) pending`,
      );
    }

    await this.mqRegistry?.close();
    await this.scanner.callLifecycleHook("onModuleDestroy");
    try {
      if (this.adapter.getInstance().server) {
        this.adapter.getInstance().stop();
      }
    } catch {
      // App may not be listening
    }
    this.removeShutdownHandlers();
    this.logger.log("Application shut down");
  }

  get<T>(token: any): T {
    return this.container.get<T>(token, {
      module: this.container.getRootModule(),
    });
  }

  resolve<T>(token: any, context?: ResolutionContext): T {
    return this.container.resolve<T>(token, {
      module: this.container.getRootModule(),
      ...context,
    });
  }

  getUrl(): string | undefined {
    const server = this.adapter.getInstance().server;
    if (!server) return undefined;
    return `http://${server.hostname}:${server.port}`;
  }

  handle(request: Request): Promise<Response> {
    return this.adapter.getInstance().handle(request);
  }

  getHttpAdapter() {
    return this.adapter.getInstance();
  }

  getContainer(): Container {
    return this.container;
  }

  getRoutes(): CompiledRouteDefinition[] {
    return [...this.compiledRoutes];
  }

  initializeRoutes(options: RouteRegistrationOptions = {}) {
    this.routeOptions = options;
    this.routesInitialized = true;
    this.refreshRoutes();
    this.registerHealthEndpoints();
    return this;
  }

  /**
   * Returns the current readiness report. The application is ready once
   * `onApplicationBootstrap` has completed AND every registered health check
   * resolves to `healthy: true`. When shutting down, readiness immediately
   * flips to `false` so load balancers stop routing traffic.
   */
  async getReadiness(): Promise<ReadinessReport> {
    if (!this.isReady || this.isShuttingDown) {
      return { ready: false, checks: [] };
    }
    const results: Array<{ name: string; healthy: boolean; detail?: any }> = [];
    let ready = true;
    for (const check of this.healthOptions.checks) {
      try {
        const result = await check();
        results.push(result);
        if (!result.healthy) ready = false;
      } catch (error: any) {
        results.push({
          name: "unknown",
          healthy: false,
          detail: { error: error?.message ?? String(error) },
        });
        ready = false;
      }
    }
    return { ready, checks: results };
  }

  getHealthOptions(): Readonly<HealthOptions> {
    return this.healthOptions;
  }

  getShutdownOptions(): Readonly<ShutdownOptions> {
    return this.shutdownOptions;
  }

  /** Used by tests / lifecycle to drive close() without raising signals. */
  isShutDown(): boolean {
    return this.isShuttingDown;
  }

  private registerHealthEndpoints() {
    if (!this.healthOptions.enabled) return;
    const elysia = this.adapter.getInstance() as any;
    if (typeof elysia?.get !== "function") return;

    elysia.get(this.healthOptions.livenessPath, () => ({ status: "ok" }));

    elysia.get(this.healthOptions.readinessPath, async ({ set }: any) => {
      const report = await this.getReadiness();
      if (!report.ready) {
        set.status = 503;
        return { status: "not_ready", checks: report.checks };
      }
      return { status: "ready", checks: report.checks };
    });
  }

  private refreshRoutesIfInitialized() {
    if (this.routesInitialized) {
      this.refreshRoutes();
      this.registerHealthEndpoints();
    }
  }

  private refreshRoutes() {
    this.adapter.reset();
    this.compiledRoutes = this.routesResolver.resolve(this.adapter, this.routeOptions);
  }

  private registerShutdownHandlers() {
    for (const signal of this.shutdownOptions.signals) {
      const handler = () => {
        void (async () => {
          await this.close();
          process.exit(0);
        })();
      };
      this.shutdownHandlers.push({ signal, handler });
      process.on(signal, handler);
    }
  }

  private removeShutdownHandlers() {
    for (const { signal, handler } of this.shutdownHandlers) {
      process.off(signal, handler);
    }
    this.shutdownHandlers = [];
  }
}
