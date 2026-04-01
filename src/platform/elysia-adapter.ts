import { Elysia } from "elysia";
import type { RouteDefinition } from "../core/scanner";
import { PARAMS_METADATA } from "../common/constants";
import type { ParamMetadata } from "../decorators/params.decorator";
import { Container, globalContainer } from "../core/container";
import { Logger } from "../services/logger.service";
import { ForbiddenException, HttpException, InternalServerErrorException } from "../exceptions";

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
      const url = new URL(request.url);
      this.logger.log(
        `${request.method} ${url.pathname} ${set.status || 200} +${duration}ms`,
        "HTTP",
      );
      this.requestStartTimes.delete(request);
    });

    this.app.onError(({ request, code, error, set }) => {
      const start = this.requestStartTimes.get(request) || Date.now();
      const duration = Date.now() - start;
      const url = new URL(request.url);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `${request.method} ${url.pathname} ${set.status || 500} +${duration}ms (${code})`,
        stack,
        "HTTP",
      );
      this.requestStartTimes.delete(request);
    });
  }

  public registerRoutes(routes: RouteDefinition[]) {
    for (const route of routes) {
      const {
        method,
        fullPath,
        controller,
        controllerInstance,
        handlerName,
        schema,
        middlewares,
        guards,
      } = route;
      const elysiaMethod = method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";

      const methodParams: ParamMetadata[] =
        (Reflect.getMetadata(PARAMS_METADATA, controller) || ({} as any))[handlerName] || [];

      // Create handler
      const handler = async (context: any) => {
        // Build arguments based on param decorators
        const args: any[] = [];

        // Ensure the args array is properly sized
        const maxIndex =
          methodParams.length > 0 ? Math.max(...methodParams.map((p) => p.index)) : -1;
        if (maxIndex >= 0) {
          args.length = maxIndex + 1;
        }

        for (const param of methodParams) {
          switch (param.type) {
            case "body":
              args[param.index] = param.name ? context.body?.[param.name] : context.body;
              break;
            case "param":
              args[param.index] = param.name ? context.params?.[param.name] : context.params;
              break;
            case "query":
              args[param.index] = param.name ? context.query?.[param.name] : context.query;
              break;
          }
        }

        try {
          return await controllerInstance[handlerName](...args);
        } catch (error) {
          const exception =
            error instanceof HttpException
              ? error
              : new InternalServerErrorException("Internal Server Error");
          context.set.status = exception.statusCode;
          return exception.toJSON();
        }
      };

      const elysiaOptions: any = {};
      if (schema) {
        if (schema.body) elysiaOptions.body = schema.body;
        if (schema.query) elysiaOptions.query = schema.query;
        if (schema.params) elysiaOptions.params = schema.params;
        if (schema.response) elysiaOptions.response = schema.response;
      }

      const elysiaGuards = (guards || []).map((guardClass: any) => {
        return async (context: any) => {
          const guardInstance = this.container.get<any>(guardClass);
          try {
            const canActivate = await guardInstance.canActivate(context);
            if (!canActivate) {
              throw new ForbiddenException();
            }
          } catch (error) {
            const exception =
              error instanceof HttpException
                ? error
                : new InternalServerErrorException("Internal Server Error");
            context.set.status = exception.statusCode;
            return exception.toJSON();
          }
        };
      });

      const allBeforeHooks = [...elysiaGuards, ...(middlewares || [])];

      if (allBeforeHooks.length > 0) {
        elysiaOptions.beforeHandle = allBeforeHooks;
      }

      (this.app as any)[elysiaMethod](fullPath, handler, elysiaOptions);

      if (this.options?.logger !== false) {
        this.logger.debug(`Mapped {${fullPath}, ${method}} route`, "Router");
      }
    }
  }

  public getInstance() {
    return this.app;
  }
}
