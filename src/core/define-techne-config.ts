import type { TechneApplicationOptions } from "../factory/techne-factory";

/**
 * Declarative Bnest configuration. Extends {@link TechneApplicationOptions}
 * with bootstrap-only fields (`module`, `port`, `host`) consumed by the
 * `bootstrap()` helper and `TechneFactory.create()` when loading
 * `bnest.config.ts` from `process.cwd()`.
 */
export type TechneConfig = TechneApplicationOptions & {
  /** Root module class. Required when calling `TechneFactory.create()` / `bootstrap()` with zero args. */
  module?: any;
  /** Port to listen on. Used by `techne dev`/`start` and the `bootstrap()` helper. Default 3000. */
  port?: number;
  /** Bind host. Default "0.0.0.0". */
  host?: string;
};

/**
 * Identity helper that gives users autocomplete on every `TechneConfig` field
 * when authoring a `bnest.config.ts` default export. The runtime returns the
 * input unchanged — all merging happens in `TechneFactory.create()`.
 */
export function defineTechneConfig(config: TechneConfig): TechneConfig {
  return config;
}

/** @deprecated use TechneConfig */
export type BnestConfig = TechneConfig;

/** @deprecated use defineTechneConfig */
export const defineBnestConfig = defineTechneConfig;
