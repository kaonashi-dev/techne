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

export class BnestApplication {
  private logger = new Logger("BnestApplication");
  private shutdownHandlers: (() => void)[] = [];
  private isShuttingDown = false;
  private routeOptions: RouteRegistrationOptions = {};
  private compiledRoutes: CompiledRouteDefinition[] = [];

  constructor(
    private readonly adapter: ElysiaAdapter,
    private readonly scanner: Scanner,
    private readonly container: Container,
    private readonly routesResolver: RoutesResolver,
    private readonly executionContext?: RouterExecutionContext,
    private readonly mqRegistry?: MqRegistry,
  ) {}

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
    this.refreshRoutes();
    return this;
  }

  enableVersioning(options: VersioningOptions): this {
    this.routeOptions.versioning = options;
    this.refreshRoutes();
    return this;
  }

  enableCors(options: CorsOptions = {}): this {
    this.adapter.enableCors(options);
    this.refreshRoutes();
    return this;
  }

  async listen(port: number, callback?: () => void) {
    this.registerShutdownHandlers();
    this.adapter.getInstance().listen(port, callback);
    await this.scanner.callLifecycleHook("onApplicationBootstrap");
    return this;
  }

  async close() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.log("Shutting down...");
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
    this.refreshRoutes();
    return this;
  }

  private refreshRoutes() {
    this.adapter.reset();
    this.compiledRoutes = this.routesResolver.resolve(this.adapter, this.routeOptions);
  }

  private registerShutdownHandlers() {
    const handler = () => {
      this.close();
    };
    this.shutdownHandlers.push(handler);
    process.on("SIGTERM", handler);
    process.on("SIGINT", handler);
  }

  private removeShutdownHandlers() {
    for (const handler of this.shutdownHandlers) {
      process.off("SIGTERM", handler);
      process.off("SIGINT", handler);
    }
    this.shutdownHandlers = [];
  }
}
