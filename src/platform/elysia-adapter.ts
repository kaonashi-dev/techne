import { Elysia } from "elysia";
import { Logger } from "../services/logger.service";
import { Container, globalContainer } from "../core/container";
import type { CompiledRouteDefinition } from "../core/router/router-execution-context";
import type { CorsOptions } from "../core/http-options";

interface ElysiaAdapterOptions {
  logger?: boolean;
  container?: Container;
}

export class ElysiaAdapter {
  private app: Elysia;
  private logger: Logger;
  private container: Container;
  private requestStartTimes = new WeakMap<Request, number>();
  private corsOptions?: CorsOptions;

  constructor(private options?: ElysiaAdapterOptions) {
    this.container = options?.container || globalContainer;
    this.logger = new Logger("ElysiaAdapter");
    this.app = this.createApp();
  }

  public reset() {
    this.app = this.createApp();
  }

  public enableCors(options: CorsOptions = {}) {
    this.corsOptions = options;
    this.reset();
  }

  private createApp() {
    const app = new Elysia();
    this.setupRequestLogging(app);
    this.setupCors(app);
    return app;
  }

  private setupRequestLogging(app: Elysia) {
    if (this.options?.logger === false) {
      return;
    }

    app.onRequest(({ request }) => {
      this.requestStartTimes.set(request, performance.now());
    });

    app.onAfterHandle(({ request, set }) => {
      const start = this.requestStartTimes.get(request) || performance.now();
      const duration = Math.round(performance.now() - start);
      const path = this.getRequestPath(request.url);
      this.logger.log(`${request.method} ${path} ${set.status || 200} +${duration}ms`, "HTTP");
      this.requestStartTimes.delete(request);
    });

    app.onError(({ request, code, error, set }) => {
      const start = this.requestStartTimes.get(request) || performance.now();
      const duration = Math.round(performance.now() - start);
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

  private setupCors(app: Elysia) {
    if (!this.corsOptions) {
      return;
    }

    app.onRequest(({ request }) => {
      if (request.method !== "OPTIONS") return;
      return new Response(null, {
        status: 204,
        headers: this.createCorsHeaders(request),
      });
    });

    app.onAfterHandle(({ request, set }) => {
      const headers = this.createCorsHeaders(request);
      set.headers = {
        ...this.normalizeHeaders(set.headers || {}),
        ...this.normalizeHeaders(headers),
      };
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

  private createCorsHeaders(request: Request): HeadersInit {
    const origin = request.headers.get("origin");
    const allowedOrigin = Array.isArray(this.corsOptions?.origin)
      ? origin && this.corsOptions.origin.includes(origin)
        ? origin
        : this.corsOptions.origin[0]
      : this.corsOptions?.origin === true || this.corsOptions?.origin === undefined
        ? (origin ?? "*")
        : typeof this.corsOptions?.origin === "string"
          ? this.corsOptions.origin
          : "*";

    return {
      "access-control-allow-origin": allowedOrigin ?? "*",
      "access-control-allow-methods": (
        this.corsOptions?.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
      ).join(","),
      "access-control-allow-headers": (
        this.corsOptions?.allowedHeaders ?? ["Content-Type", "Authorization", "X-Version"]
      ).join(","),
      ...(this.corsOptions?.exposedHeaders
        ? { "access-control-expose-headers": this.corsOptions.exposedHeaders.join(",") }
        : {}),
      ...(this.corsOptions?.credentials ? { "access-control-allow-credentials": "true" } : {}),
      ...(this.corsOptions?.maxAge !== undefined
        ? { "access-control-max-age": `${this.corsOptions.maxAge}` }
        : {}),
    };
  }

  private normalizeHeaders(
    headers: HeadersInit | Record<string, unknown>,
  ): Record<string, string | number> {
    const normalized: Record<string, string | number> = {};

    if (headers instanceof Headers) {
      for (const [key, value] of headers.entries()) {
        normalized[key] = value;
      }
      return normalized;
    }

    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        normalized[key] = value;
      }
      return normalized;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === "string" || typeof value === "number") {
        normalized[key] = value;
      } else if (Array.isArray(value)) {
        normalized[key] = value.join(",");
      }
    }

    return normalized;
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
