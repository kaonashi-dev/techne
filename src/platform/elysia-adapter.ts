import { Elysia } from "elysia";
import { Logger } from "../services/logger.service";
import { Container, globalContainer } from "../core/container";
import type { CompiledRouteDefinition } from "../core/router/router-execution-context";

interface ElysiaAdapterOptions {
  logger?: boolean;
  container?: Container;
}

export class ElysiaAdapter {
  private app: Elysia;
  private logger: Logger;
  private container: Container;
  private requestStartTimes = new WeakMap<Request, number>();

  constructor(private options?: ElysiaAdapterOptions) {
    this.container = options?.container || globalContainer;
    this.app = new Elysia();
    this.logger = new Logger("ElysiaAdapter");
    this.setupRequestLogging();
  }

  private setupRequestLogging() {
    if (this.options?.logger === false) {
      return;
    }

    this.app.onRequest(({ request }) => {
      this.requestStartTimes.set(request, Date.now());
    });

    this.app.onAfterHandle(({ request, set }) => {
      const start = this.requestStartTimes.get(request) || Date.now();
      const duration = Date.now() - start;
      const path = this.getRequestPath(request.url);
      this.logger.log(`${request.method} ${path} ${set.status || 200} +${duration}ms`, "HTTP");
      this.requestStartTimes.delete(request);
    });

    this.app.onError(({ request, code, error, set }) => {
      const start = this.requestStartTimes.get(request) || Date.now();
      const duration = Date.now() - start;
      const path = this.getRequestPath(request.url);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `${request.method} ${path} ${set.status || 500} +${duration}ms (${code})`,
        stack,
        "HTTP",
      );
      this.requestStartTimes.delete(request);
    });
  }

  public registerRoutes(routes: CompiledRouteDefinition[]) {
    for (const route of routes) {
      const elysiaMethod = route.method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "patch"
        | "delete";

      const elysiaOptions: any = {};
      if (route.schema) {
        if (route.schema.body) elysiaOptions.body = route.schema.body;
        if (route.schema.query) elysiaOptions.query = route.schema.query;
        if (route.schema.params) elysiaOptions.params = route.schema.params;
        if (route.schema.response) elysiaOptions.response = route.schema.response;
      }

      if (route.beforeHandle && route.beforeHandle.length > 0) {
        elysiaOptions.beforeHandle = route.beforeHandle;
      }

      (this.app as any)[elysiaMethod](route.fullPath, route.handler, elysiaOptions);

      if (this.options?.logger !== false) {
        this.logger.debug(`Mapped {${route.fullPath}, ${route.method}} route`, "Router");
      }
    }
  }

  public getContainer() {
    return this.container;
  }

  public getInstance() {
    return this.app;
  }

  private getRequestPath(url: string): string {
    const protocolIndex = url.indexOf("://");
    if (protocolIndex === -1) {
      return url;
    }

    const pathStart = url.indexOf("/", protocolIndex + 3);
    if (pathStart === -1) {
      return "/";
    }

    const queryStart = url.indexOf("?", pathStart);
    return queryStart === -1 ? url.slice(pathStart) : url.slice(pathStart, queryStart);
  }
}
