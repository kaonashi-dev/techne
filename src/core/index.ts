export * from "./application-context";
export * from "./techne-application";
export * from "./container";
export * from "./context-id-factory";
export * from "./define-feature";
export * from "./define-techne-config";
export * from "./http-options";
export * from "./module-ref";
export * from "./plugins/define-plugin";
export * from "./reflector";
export * from "./scope";
export * from "../factory/techne-factory";

import {
  TechneFactory,
  loadTechneConfigFile,
  type TechneApplicationOptions,
  type AppBootstrapConfig,
} from "../factory/techne-factory";
import type { TechneApplication } from "./techne-application";
import { Logger } from "../services/logger.service";

/**
 * Shorthand for {@link TechneFactory.create}. Mirrors the declarative API:
 * `await techne()` reads the flat app config from `techne.config.ts`.
 */
export function techne(): Promise<TechneApplication>;
export function techne(config: AppBootstrapConfig): Promise<TechneApplication>;
export function techne(
  config?: AppBootstrapConfig,
): Promise<TechneApplication> {
  if (config === undefined) return TechneFactory.create();
  return TechneFactory.create(config);
}

/** @deprecated use `techne()` */
export const bnest = techne;

export interface BootstrapOverrides extends TechneApplicationOptions {
  port?: number;
  host?: string;
}

/**
 * Create the application AND start listening using values declared in
 * `techne.config.ts` (with overrides applied on top). Returns the started app.
 *
 * Resolution order for `port`: explicit `options.port` → config `port` →
 * `Bun.env.PORT` → 3000. `host` defaults to "0.0.0.0".
 */
export async function bootstrap(
  config?: AppBootstrapConfig & BootstrapOverrides,
): Promise<TechneApplication> {
  const { port: optPort, host: optHost, ...factoryOptions } = config ?? {};
  const app =
    config === undefined
      ? await TechneFactory.create()
      : await TechneFactory.create(factoryOptions as AppBootstrapConfig);

  // Re-read the config to discover port/host the user declared there. This is
  // cheap because TechneFactory.create() caches the file load by cwd.
  const fileConfig = await loadTechneConfigFile();
  const port =
    optPort ?? fileConfig?.port ?? (Bun.env.PORT ? Number(Bun.env.PORT) : undefined) ?? 3000;
  const host = optHost ?? fileConfig?.host ?? "0.0.0.0";

  const logger = new Logger("Techne");
  await app.listen(port, () => {
    logger.log(`🚀 Listening on http://${host}:${port}`);
  });
  return app;
}
