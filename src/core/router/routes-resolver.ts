import type { Scanner } from "../scanner";
import type { ElysiaAdapter } from "../../platform/elysia-adapter";
import { RouterExecutionContext } from "./router-execution-context";
import { RouterExplorer } from "./router-explorer";
import { RouterResponseController } from "./router-response-controller";

export class RoutesResolver {
  private readonly explorer: RouterExplorer;
  private readonly responseController = new RouterResponseController();
  public readonly executionContext = new RouterExecutionContext(this.responseController);

  constructor(private readonly scanner: Scanner) {
    this.explorer = new RouterExplorer(scanner);
  }

  public resolve(adapter: ElysiaAdapter) {
    const container = this.scanner.getContainer();
    const routes = this.explorer
      .explore()
      .map((route) => this.executionContext.create(route, container));

    adapter.registerRoutes(routes);
    return routes;
  }
}
