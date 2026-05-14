import * as fs from "node:fs";
import * as path from "node:path";
import { Inject } from "../decorators/inject.decorator";
import { definePlugin } from "../core/plugins/define-plugin";
import type { AppConfig } from "./define-config";
import { ConfigService } from "./config.service";
import { APP_CONFIG, CONFIG_OPTIONS, CONFIG_STORE } from "./tokens";

/** Inject the active `AppConfig` instance produced by `appConfig()`. */
export const InjectConfig = (): ParameterDecorator => Inject(APP_CONFIG);

export interface ConfigModuleOptions {
  envFilePath?: string | string[];
  ignoreEnvFile?: boolean;
  isGlobal?: boolean;
  load?: Array<() => Record<string, any>>;
  validate?: (config: Record<string, any>) => Record<string, any>;
  expandVariables?: boolean;
}

function parseEnv(contents: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function expandVariables(
  config: Record<string, any>,
  lookup: Record<string, any>,
): Record<string, any> {
  const expanded: Record<string, any> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") {
      expanded[key] = value;
      continue;
    }
    expanded[key] = value.replace(/\$\{([^}]+)\}/g, (_match, name) => `${lookup[name] ?? ""}`);
  }
  return expanded;
}

function mergeRecords(...records: Array<Record<string, any> | undefined>): Record<string, any> {
  return records.reduce<Record<string, any>>((acc, record) => {
    if (!record) return acc;
    for (const [key, value] of Object.entries(record)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        acc[key] &&
        typeof acc[key] === "object" &&
        !Array.isArray(acc[key])
      ) {
        acc[key] = mergeRecords(acc[key], value as Record<string, any>);
      } else {
        acc[key] = value;
      }
    }
    return acc;
  }, {});
}

function buildConfig(options: ConfigModuleOptions): Record<string, any> {
  const envPaths = Array.isArray(options.envFilePath)
    ? options.envFilePath
    : [options.envFilePath ?? ".env"];

  let fileConfig: Record<string, any> = {};
  if (!options.ignoreEnvFile) {
    for (const envPath of envPaths) {
      const fullPath = path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
      if (!fs.existsSync(fullPath)) continue;
      fileConfig = mergeRecords(fileConfig, parseEnv(fs.readFileSync(fullPath, "utf8")));
    }
  }

  const runtimeEnv = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, any>;

  const loadedConfig = (options.load ?? []).map((factory) => factory());
  let store = mergeRecords(fileConfig, runtimeEnv, ...loadedConfig);

  if (options.expandVariables) {
    store = expandVariables(store, store);
  }

  for (const [key, value] of Object.entries(store)) {
    if (process.env[key] === undefined && typeof value === "string") {
      process.env[key] = value;
    }
  }

  return options.validate ? options.validate(store) : store;
}

export function config(options: ConfigModuleOptions = {}) {
  return definePlugin({
    name: "config",
    setup(ctx) {
      const store = buildConfig(options);
      ctx.provide(CONFIG_OPTIONS, options);
      ctx.provide(CONFIG_STORE, store);
      ctx.registerProviders([ConfigService]);
    },
  });
}

export function appConfig<C extends AppConfig<any>>(cfg: C) {
  return definePlugin({
    name: "config:app",
    setup(ctx) {
      ctx.provide(APP_CONFIG, cfg);
    },
  });
}
