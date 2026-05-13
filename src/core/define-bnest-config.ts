import type { BnestApplicationOptions } from "../factory/bnest-factory";

/**
 * Declarative Bnest configuration. Extends {@link BnestApplicationOptions}
 * with bootstrap-only fields (`module`, `port`, `host`) consumed by the
 * `bootstrap()` helper and `BnestFactory.create()` when loading
 * `bnest.config.ts` from `process.cwd()`.
 */
export type BnestConfig = BnestApplicationOptions & {
  /** Root module class. Required when calling `BnestFactory.create()` / `bootstrap()` with zero args. */
  module?: any;
  /** Port to listen on. Used by `bnest dev`/`start` and the `bootstrap()` helper. Default 3000. */
  port?: number;
  /** Bind host. Default "0.0.0.0". */
  host?: string;
};

/**
 * Identity helper that gives users autocomplete on every `BnestConfig` field
 * when authoring a `bnest.config.ts` default export. The runtime returns the
 * input unchanged — all merging happens in `BnestFactory.create()`.
 */
export function defineBnestConfig(config: BnestConfig): BnestConfig {
  return config;
}
