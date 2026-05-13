/**
 * Techne ExecutionContext / ArgumentsHost abstractions.
 *
 * ExecutionContext is the object that Guards, Interceptors, and Exception
 * Filters receive. It exposes the underlying transport arguments (HTTP today,
 * RPC/WS in the future) along with references to the handler method and
 * controller class so that cross-cutting concerns can read decorator metadata
 * via `Reflector`.
 */

export type ContextType = "http" | "rpc" | "ws";

export interface HttpArgumentsHost {
  /** Returns the raw request-like object (Elysia context). */
  getRequest<T = any>(): T;
  /** Returns the raw response-like object. In Elysia this is `context.set`. */
  getResponse<T = any>(): T;
  /** Returns the `next` function for middleware-style transports. */
  getNext<T = any>(): T;
}

export interface RpcArgumentsHost {
  getData<T = any>(): T;
  getContext<T = any>(): T;
}

export interface WsArgumentsHost {
  getData<T = any>(): T;
  getClient<T = any>(): T;
}

export interface ArgumentsHost {
  getArgs<T extends any[] = any[]>(): T;
  getArgByIndex<T = any>(index: number): T;
  switchToHttp(): HttpArgumentsHost;
  switchToRpc(): RpcArgumentsHost;
  switchToWs(): WsArgumentsHost;
  getType<TContext extends string = ContextType>(): TContext;
}

export interface ExecutionContext extends ArgumentsHost {
  /** Returns the controller class. */
  getClass<T = any>(): new (...args: any[]) => T;
  /** Returns the handler method reference (so Reflector can read its metadata). */
  getHandler(): Function;
}

/**
 * Concrete implementation backed by an Elysia request context.
 *
 * The host is created lazily — only routes that have at least one guard,
 * interceptor, or filter allocate one per request. Routes with none keep the
 * fast path and never touch this class.
 *
 * For backward compatibility with legacy Bnest guards/interceptors/filters
 * that read from the raw Elysia context directly (`ctx.query`, `ctx.body`,
 * etc.), the common fields are exposed as getters that delegate to the
 * underlying context. New code should prefer the Techne
 * `ctx.switchToHttp().getRequest()` API.
 */
export class ExecutionContextHost implements ExecutionContext {
  private httpHost: HttpArgumentsHost | undefined;

  constructor(
    private readonly elysiaContext: any,
    private readonly controllerClass: new (...args: any[]) => any,
    private readonly handler: Function,
    private readonly contextType: ContextType = "http",
  ) {}

  // ─── Legacy pass-through getters ─────────────────────────────────────────
  // These mirror common Elysia context fields so code written against the
  // raw context keeps working when it receives an ExecutionContextHost.
  get body(): any {
    return this.elysiaContext?.body;
  }
  get query(): any {
    return this.elysiaContext?.query;
  }
  get params(): any {
    return this.elysiaContext?.params;
  }
  get headers(): any {
    return this.elysiaContext?.headers;
  }
  get request(): any {
    return this.elysiaContext?.request;
  }
  get set(): any {
    return this.elysiaContext?.set;
  }
  get store(): any {
    return this.elysiaContext?.store;
  }
  get cookie(): any {
    return this.elysiaContext?.cookie;
  }
  get path(): any {
    return this.elysiaContext?.path;
  }
  get route(): any {
    return this.elysiaContext?.route;
  }

  public getClass<T = any>(): new (...args: any[]) => T {
    return this.controllerClass as new (...args: any[]) => T;
  }

  public getHandler(): Function {
    return this.handler;
  }

  public getArgs<T extends any[] = any[]>(): T {
    return [this.elysiaContext] as unknown as T;
  }

  public getArgByIndex<T = any>(index: number): T {
    return this.getArgs()[index] as T;
  }

  public getType<TContext extends string = ContextType>(): TContext {
    return this.contextType as unknown as TContext;
  }

  public switchToHttp(): HttpArgumentsHost {
    if (!this.httpHost) {
      const ctx = this.elysiaContext;
      this.httpHost = {
        getRequest: <T = any>() => ctx as T,
        getResponse: <T = any>() => ctx?.set as T,
        getNext: <T = any>() => undefined as unknown as T,
      };
    }
    return this.httpHost;
  }

  public switchToRpc(): RpcArgumentsHost {
    const ctx = this.elysiaContext;
    return {
      getData: <T = any>() => ctx as T,
      getContext: <T = any>() => ctx as T,
    };
  }

  public switchToWs(): WsArgumentsHost {
    const ctx = this.elysiaContext;
    return {
      getData: <T = any>() => ctx as T,
      getClient: <T = any>() => ctx as T,
    };
  }
}
