import type { Context, ContextManager } from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A minimal `AsyncLocalStorage`-backed OTel context manager.
 *
 * We roll our own (instead of `@opentelemetry/context-async-hooks`) for one
 * reason: {@link enterWith}. Elysia's lifecycle phases aren't a single callback
 * we can wrap in `context.with(...)`, so we set the active span in `onRequest`
 * via `enterWith` and let it propagate to the handler and terminal hooks — the
 * exact pattern the framework already uses for its `requestContext` ALS.
 *
 * `import type` keeps `@opentelemetry/api` out of the runtime require graph;
 * the `ContextManager` interface is erased, leaving only the structural shape.
 */
export class AlsContextManager implements ContextManager {
  private readonly als = new AsyncLocalStorage<Context>();

  constructor(private readonly root: Context) {}

  active(): Context {
    return this.als.getStore() ?? this.root;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    context: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.als.run(context, () => fn.apply(thisArg as ThisParameterType<F>, args));
  }

  bind<T>(context: Context, target: T): T {
    if (typeof target === "function") {
      const als = this.als;
      const fn = target as (...a: unknown[]) => unknown;
      const bound = function (this: unknown, ...args: unknown[]) {
        return als.run(context, () => fn.apply(this, args));
      };
      return bound as unknown as T;
    }
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.als.disable();
    return this;
  }

  /** Set `context` as active for the current async execution and everything it spawns. */
  enterWith(context: Context): void {
    this.als.enterWith(context);
  }
}
