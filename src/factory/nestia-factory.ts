import { Scanner } from "../core/scanner";
import { Container, globalContainer } from "../core/container";
import { RoutesResolver } from "../core/router/routes-resolver";
import { ElysiaAdapter } from "../platform/elysia-adapter";
import { Logger } from "../services/logger.service";
import { BusRegistry } from "../cqrs/bus";
import { MicroservicesAdapter } from "../microservices/adapter";
import type { MicroserviceOptions } from "../microservices/types";

export interface BnestApplicationOptions {
  logger?: boolean | string[];
  container?: Container;
}

export class BnestFactory {
  public static create(module: any, options?: BnestApplicationOptions) {
    const loggerEnabled = options?.logger !== false;
    Logger.setEnabled(loggerEnabled);

    const logger = new Logger("BnestFactory");
    logger.log("Starting application initialization...");

    const container = options?.container || globalContainer;
    const scanner = new Scanner({ logger: loggerEnabled, container });
    scanner.scan(module);
    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    const adapter = new ElysiaAdapter({ logger: loggerEnabled, container });
    const routesResolver = new RoutesResolver(scanner);
    const routes = routesResolver.resolve(adapter);

    logger.log("Dependencies initialized");
    logger.log(`Mapped ${routes.length} routes`);

    return adapter.getInstance();
  }

  public static createMicroservice(module: any, options: MicroserviceOptions) {
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    scanner.scan(module);

    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([...scanner.getProviders(), ...scanner.getControllers()]);

    const adapter = new MicroservicesAdapter(container);
    return adapter.create([...scanner.getProviders(), ...scanner.getControllers()], options);
  }
}

/** @deprecated Use BnestFactory instead */
export const NestiaFactory = BnestFactory;
