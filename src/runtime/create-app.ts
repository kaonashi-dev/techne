import { Elysia } from "../vendor/elysia/index";
import type { ElysiaConfig, EventScope } from "../vendor/elysia/types";

/**
 * Create a native Elysia application or feature plugin.
 *
 * Handlers, schemas, hooks and route types belong to Elysia. Techne only enables
 * compilation before listening by default; all native options remain available.
 * Return the fluent chain from feature factories to preserve route inference.
 */
export function createApp<
  const Prefix extends string = "",
  const Scope extends EventScope = "local",
>(options?: ElysiaConfig<Prefix, Scope>): Elysia<Prefix, Scope> {
  return new Elysia<Prefix, Scope>({ precompile: true, ...options });
}
