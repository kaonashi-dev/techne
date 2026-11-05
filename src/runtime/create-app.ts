import { App } from "../server/app";
import type { AppOptions, HookScope } from "../server/types";

/**
 * Create a Techne application or feature plugin.
 *
 * Return the fluent chain from feature factories to keep route inference:
 * `export type App = ReturnType<typeof buildApp>`.
 */
export function createApp<
  const Prefix extends string = "",
  const Scope extends HookScope = "local",
>(options?: AppOptions<Prefix, Scope>): App<Prefix, Scope> {
  return new App<Prefix, Scope>(options);
}
