import type { TechneApplication } from "../techne-application";
import type { Logger } from "../../services/logger.service";

/**
 * Context handed to a plugin's `setup()`. The context is the only sanctioned
 * surface for plugins to mutate framework state, register DI tokens, subscribe
 * to lifecycle events, or hook into the raw Elysia instance.
 */
export interface PluginContext {
  /** The hosting application. Prefer the helpers below over reaching in. */
  app: TechneApplication;
  /**
   * Read-only view of the options passed to `TechneFactory.create`. Plugins
   * should treat this as informational; mutating it is unsupported.
   */
  options: Readonly<Record<string, unknown>>;
  /** Register a token in the DI container so other plugins/providers can inject it. */
  provide<T>(token: any, value: T): void;
  /** Register one or more providers into the DI container (class, value, factory, or existing). */
  registerProviders(providers: any[]): void;
  /** Resolve a token from the root module's DI scope. */
  resolve<T>(token: any): T;
  /**
   * Subscribe to the "application is ready" lifecycle. Handlers run AFTER
   * `onApplicationBootstrap` and BEFORE the HTTP server starts listening.
   */
  onReady(handler: () => void | Promise<void>): void;
  /**
   * Subscribe to graceful shutdown. Handlers fire in LIFO order BEFORE the
   * mq registry closes and BEFORE `onModuleDestroy` runs.
   */
  onShutdown(handler: () => void | Promise<void>): void;
  /** Access the raw Elysia instance for low-level work (routes, hooks, etc.). */
  http(): import("elysia").Elysia;
  /** Logger pre-scoped to the plugin's name. */
  logger: Logger;
}

export interface PluginDefinition<TOptions = void> {
  name: string;
  /** Optional semver-ish version (informational only). */
  version?: string;
  /** Names of other plugins that must be registered before this one. */
  dependencies?: string[];
  /** Called once at registration with the resolved context and options. */
  setup: (ctx: PluginContext, options: TOptions) => void | Promise<void>;
}

/**
 * Typing helper that returns the input plugin unchanged. Useful only for
 * inferring `TOptions` at the call site. The actual registration happens in
 * `TechneApplication.register()`.
 */
export function definePlugin<TOptions = void>(
  def: PluginDefinition<TOptions>,
): PluginDefinition<TOptions> {
  return def;
}
