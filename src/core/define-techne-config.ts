import type { AppBootstrapConfig } from "../factory/techne-factory";

/**
 * Declarative Techne configuration. Extends {@link AppBootstrapConfig} with
 * bootstrap-only fields (`port`, `host`) consumed by the `bootstrap()` helper
 * when loading `techne.config.ts` from `process.cwd()`.
 */
export type TechneConfig = AppBootstrapConfig & {
  /** Port to listen on. Used by `techne dev`/`start` and the `bootstrap()` helper. Default 3000. */
  port?: number;
  /** Bind host. Default "0.0.0.0". */
  host?: string;
};

/**
 * Identity helper that gives users autocomplete on every `TechneConfig` field
 * when authoring a `techne.config.ts` default export. The runtime returns the
 * input unchanged — all merging happens in `TechneFactory.create()`.
 */
export function defineTechneConfig(config: TechneConfig): TechneConfig {
  return config;
}
