/**
 * Custom DI tokens used across the demo. Symbol tokens are resolved with
 * `@Inject(TOKEN)` and registered with `useValue` / `useFactory` providers.
 */
export const API_KEY = Symbol("API_KEY");
export const BUILD_INFO = Symbol("BUILD_INFO");

export interface BuildInfo {
  readonly startedAt: string;
  readonly node: string;
}
