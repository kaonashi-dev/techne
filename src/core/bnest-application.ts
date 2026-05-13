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
import type { PluginContext, PluginDefinition } from "./plugins/define-plugin";

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
  /**
   * Raw user-supplied options (cors, prefix, etc.). Made available to plugins
   * via `PluginContext.options` as a frozen, read-only view.
   */
  userOptions?: Record<string, unknown>;
}

interface RegisteredPlugin {
  def: PluginDefinition<any>;
  options: any;
}

const DEFAULT_SHUTDOWN: ShutdownOptions = {
  gracePeriod: 10_000,
  signals: ["SIGTERM", "SIGINT"],
};

// One-time deprecation warnings keyed by method name. The warning fires at
// most once per method per process so noisy test suites don't get spammed.
const deprecationWarned = new Set<string>();
function warnDeprecatedSetter(method: string) {
  if (deprecationWarned.has(method)) return;
  deprecationWarned.add(method);
  new Logger("TechneApplication").warn(
    `${method}() is deprecated: declare this in bnest.config.ts instead. Will be removed in v1.0.`,
  );
}

const DEFAULT_HEALTH: HealthOptions = {
  enabled: true,
  livenessPath: "/healthz",
  readinessPath: "/readyz",
  checks: [],
};

export class BnestApplication {
  private logger = new Logger("TechneApplication");
  private shutdownHandlers: { signal: ShutdownSignal; handler: () => void }[] = [];
  private isShuttingDown = false;
  private isReady = false;
  private routeOptions: RouteRegistrationOptions = {};
  private compiledRoutes: CompiledRouteDefinition[] = [];
  private routesInitialized = false;
  private readonly shutdownOptions: ShutdownOptions;
  private readonly healthOptions: HealthOptions;
  private readonly userOptions: Readonly<Record<string, unknown>>;
  private readonly registered = new Map<string, RegisteredPlugin>();
  private readyHandlers: Array<() => void | Promise<void>> = [];
  private shutdownPluginHandlers: Array<() => void | Promise<void>> = [];

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
    this.userOptions = Object.freeze({ ...(options?.userOptions ?? {}) });
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
    warnDeprecatedSetter("useGlobalGuards");
    const appliedInTime = this.executionContext?.setGlobalGuards(guards) ?? false;
    if (!appliedInTime) {
      this.logger.warn(
        "useGlobalGuards() was called after routes were registered — only routes registered after this call will receive the new guards. Pass `globalGuards` to BnestFactory.create() for retroactive application.",
      );
    }
    return this;
  }

  setGlobalPrefix(prefix: string, options: GlobalPrefixOptions = {}): this {
    warnDeprecatedSetter("setGlobalPrefix");
    this.routeOptions.globalPrefix = { prefix, exclude: options.exclude };
    this.refreshRoutesIfInitialized();
    return this;
  }

  enableVersioning(options: VersioningOptions): this {
    warnDeprecatedSetter("enableVersioning");
    this.routeOptions.versioning = options;
    this.refreshRoutesIfInitialized();
    return this;
  }

  enableCors(options: CorsOptions = {}): this {
    warnDeprecatedSetter("enableCors");
    this.adapter.enableCors(options);
    this.refreshRoutesIfInitialized();
    return this;
  }

  /** @internal — used by BnestFactory to apply declarative CORS without firing the deprecation. */
  applyCorsFromConfig(options: CorsOptions): this {
    this.adapter.enableCors(options);
    this.refreshRoutesIfInitialized();
    return this;
  }

  async listen(port: number, callback?: () => void) {
    this.registerShutdownHandlers();
    // Fire bootstrap BEFORE accepting traffic so the app isn't reachable
    // until every onApplicationBootstrap hook has resolved.
    await this.scanner.callLifecycleHook("onApplicationBootstrap");
    // Plugin onReady handlers run sequentially after module bootstrap so
    // plugins can depend on the bootstrap state and on each other.
    await this.fireReadyHandlers();
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

    // Plugin onShutdown handlers run in reverse registration order BEFORE the
    // mq registry closes and BEFORE onModuleDestroy so dependents tear down
    // before their dependencies.
    await this.fireShutdownHandlers();
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

  /**
   * Register a first-class Bnest plugin. Plugins are the preferred extension
   * mechanism — they compose with the module system, can read DI, hook into
   * lifecycle, and reach the raw Elysia instance.
   *
   * Throws when a named dependency hasn't been registered yet, when a
   * different plugin with the same `name` is already registered, and lets
   * an idempotent re-registration of the same `setup` function no-op.
   */
  async register<TOptions>(
    plugin: PluginDefinition<TOptions>,
    options?: TOptions,
  ): Promise<this> {
    if (!plugin || typeof plugin.name !== "string" || plugin.name.length === 0) {
      throw new Error("Plugin must have a non-empty `name`.");
    }
    if (typeof plugin.setup !== "function") {
      throw new Error(`Plugin "${plugin.name}" must define a setup() function.`);
    }

    const existing = this.registered.get(plugin.name);
    if (existing) {
      if (existing.def.setup === plugin.setup) {
        this.logger.warn(`Plugin "${plugin.name}" already registered — skipping.`);
        return this;
      }
      throw new Error(
        `Plugin "${plugin.name}" is already registered with a different setup function.`,
      );
    }

    for (const dep of plugin.dependencies ?? []) {
      if (!this.registered.has(dep)) {
        throw new Error(
          `Plugin "${plugin.name}" depends on "${dep}", which has not been registered yet.`,
        );
      }
    }

    const ctx: PluginContext = {
      app: this,
      options: this.userOptions,
      provide: <T>(token: any, value: T) => {
        // For classes, container.set is sufficient (resolve falls through to
        // instances for function-typed tokens). For symbols/strings we must
        // register as a value provider so resolve() finds it.
        if (typeof token === "function") {
          this.container.set(token, value);
        } else {
          this.container.addProvider(
            { provide: token, useValue: value } as any,
            this.container.getRootModule(),
          );
        }
      },
      resolve: <T>(token: any) => this.get<T>(token),
      onReady: (handler) => {
        this.readyHandlers.push(handler);
      },
      onShutdown: (handler) => {
        this.shutdownPluginHandlers.push(handler);
      },
      http: () => this.adapter.getInstance(),
      logger: new Logger(`plugin:${plugin.name}`),
    };

    this.registered.set(plugin.name, { def: plugin, options });
    await plugin.setup(ctx, options as TOptions);
    return this;
  }

  /**
   * Shorthand for registering a native Elysia plugin against the underlying
   * Elysia instance. Returns `this` for chaining. Prefer `register()` for
   * Bnest-native plugins; this is a passthrough for ecosystem plugins.
   *
   * Note: Elysia composes plugins onto the current app, so any routes the
   * plugin adds become available immediately. The plugin sees Bnest-mapped
   * routes as already registered — this matches Elysia's documented
   * "register plugins before routes that depend on them" guidance.
   */
  use(elysiaPlugin: any): this {
    this.adapter.getInstance().use(elysiaPlugin);
    return this;
  }

  /**
   * Names of every plugin that has been registered, in registration order.
   * Useful for diagnostics and dependency checks.
   */
  getRegisteredPlugins(): string[] {
    return [...this.registered.keys()];
  }

  private async fireReadyHandlers(): Promise<void> {
    for (const handler of this.readyHandlers) {
      await handler();
    }
  }

  private async fireShutdownHandlers(): Promise<void> {
    // LIFO so dependents shut down before their dependencies.
    for (let i = this.shutdownPluginHandlers.length - 1; i >= 0; i--) {
      const handler = this.shutdownPluginHandlers[i];
      try {
        await handler!();
      } catch (error: any) {
        this.logger.error(
          `Plugin shutdown handler failed: ${error?.message || error}`,
          error?.stack,
          "Plugin",
        );
      }
    }
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

/** Canonical name. `BnestApplication` is kept as a deprecated alias through v0.4.x. */
export { BnestApplication as TechneApplication };
