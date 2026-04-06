import type { Elysia } from "elysia";
import type { Scanner } from "./scanner";
import type { Container } from "./container";
import type { RouterExecutionContext } from "./router/router-execution-context";
import type { ExceptionFilter } from "../interfaces/exception-filter.interface";
import type { BnestInterceptor } from "../interfaces/interceptor.interface";
import type { PipeTransform } from "../interfaces/pipe-transform.interface";
import { Logger } from "../services/logger.service";

export class BnestApplication {
  private logger = new Logger("BnestApplication");
  private shutdownHandlers: (() => void)[] = [];
  private isShuttingDown = false;

  constructor(
    private readonly app: Elysia,
    private readonly scanner: Scanner,
    private readonly container: Container,
    private readonly executionContext?: RouterExecutionContext,
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

  async listen(port: number, callback?: () => void) {
    this.registerShutdownHandlers();
    this.app.listen(port, callback);
    await this.scanner.callLifecycleHook("onApplicationBootstrap");
    return this;
  }

  async close() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.log("Shutting down...");
    await this.scanner.callLifecycleHook("onModuleDestroy");
    try {
      this.app.stop();
    } catch {
      // App may not be listening
    }
    this.removeShutdownHandlers();
    this.logger.log("Application shut down");
  }

  get<T>(token: any): T {
    return this.container.get<T>(token);
  }

  getUrl(): string | undefined {
    const server = this.app.server;
    if (!server) return undefined;
    return `http://${server.hostname}:${server.port}`;
  }

  handle(request: Request): Promise<Response> {
    return this.app.handle(request);
  }

  getHttpAdapter(): Elysia {
    return this.app;
  }

  getContainer(): Container {
    return this.container;
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
