export * from "./application-context";
export * from "./bnest-application";
export * from "./container";
export * from "./context-id-factory";
export * from "./define-bnest-config";
export * from "./http-options";
export * from "./module-ref";
export * from "./plugins/define-plugin";
export * from "./reflector";
export * from "./scope";
export * from "../factory/bnest-factory";

import {
  BnestFactory,
  loadBnestConfigFile,
  type BnestApplicationOptions,
} from "../factory/bnest-factory";
import type { BnestApplication } from "./bnest-application";
import { Logger } from "../services/logger.service";

/**
 * Shorthand for {@link BnestFactory.create}. Mirrors the declarative API:
 * `await bnest()` reads the root module and options from `bnest.config.ts`.
 */
export function bnest(): Promise<BnestApplication>;
export function bnest(module: any): Promise<BnestApplication>;
export function bnest(module: any, options: BnestApplicationOptions): Promise<BnestApplication>;
export function bnest(module?: any, options?: BnestApplicationOptions): Promise<BnestApplication> {
  if (module === undefined) return BnestFactory.create();
  if (options === undefined) return BnestFactory.create(module);
  return BnestFactory.create(module, options);
}

export interface BootstrapOverrides extends BnestApplicationOptions {
  port?: number;
  host?: string;
}

/**
 * Create the application AND start listening using values declared in
 * `bnest.config.ts` (with overrides applied on top). Returns the started app.
 *
 * Resolution order for `port`: explicit `options.port` → config `port` →
 * `Bun.env.PORT` → 3000. `host` defaults to "0.0.0.0".
 */
export async function bootstrap(
  module?: any,
  options?: BootstrapOverrides,
): Promise<BnestApplication> {
  const { port: optPort, host: optHost, ...factoryOptions } = options ?? {};
  const app =
    module === undefined
      ? await BnestFactory.create()
      : await BnestFactory.create(module, factoryOptions as BnestApplicationOptions);

  // Re-read the config to discover port/host the user declared there. This is
  // cheap because BnestFactory.create() caches the file load by cwd.
  const fileConfig = await loadBnestConfigFile();
  const port =
    optPort ??
    fileConfig?.port ??
    (Bun.env.PORT ? Number(Bun.env.PORT) : undefined) ??
    3000;
  const host = optHost ?? fileConfig?.host ?? "0.0.0.0";

  const logger = new Logger("Techne");
  await app.listen(port, () => {
    logger.log(`🚀 Listening on http://${host}:${port}`);
  });
  return app;
}
