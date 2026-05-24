import type { Container, ResolutionContext } from "./container";
import type { Scanner } from "./scanner";
import { Logger } from "../services/logger.service";
import type { MqRegistry } from "../mq/registry";

export class TechneApplicationContext {
  private readonly logger = new Logger("TechneApplicationContext");
  private isClosing = false;

  constructor(
    private readonly scanner: Scanner,
    private readonly container: Container,
    private readonly mqRegistry?: MqRegistry,
  ) {}

  get<T>(token: any): T {
    return this.container.get<T>(token);
  }

  resolve<T>(token: any, context?: ResolutionContext): T {
    return this.container.resolve<T>(token, context);
  }

  getContainer(): Container {
    return this.container;
  }

  async init(): Promise<this> {
    await this.scanner.callLifecycleHook("onApplicationBootstrap");
    return this;
  }

  async close() {
    if (this.isClosing) return;
    this.isClosing = true;
    this.logger.log("Shutting down application context...");
    await this.mqRegistry?.close();
    await this.scanner.callLifecycleHook("onModuleDestroy");
  }
}
