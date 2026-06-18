import { appConfig, defineConfig, t } from "../../../../src/config/index.ts";

/**
 * Typed, validated configuration. Values are read from the environment and
 * checked against the TypeBox schema at boot; a bad value throws
 * `ConfigValidationError` before the HTTP server starts.
 *
 * Fields are optional so the demo boots with zero environment setup; handlers
 * fall back to sensible defaults via `??`.
 */
export const typedConfig = defineConfig({
  schema: t.Object({
    APP_NAME: t.Optional(t.String({ minLength: 1 })),
    PORT: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
    JWT_SECRET: t.Optional(t.String({ minLength: 8 })),
    LOG_LEVEL: t.Optional(
      t.Union([
        t.Literal("error"),
        t.Literal("warn"),
        t.Literal("log"),
        t.Literal("debug"),
        t.Literal("verbose"),
      ]),
    ),
  }),
});

export type AppConfigType = typeof typedConfig;

/** Plugin that exposes {@link typedConfig} via `@InjectConfig()`. */
export const appConfigPlugin = appConfig(typedConfig);

/** Resolved JWT secret shared by the plugin and any direct signing helpers. */
export const JWT_SECRET = typedConfig.get("JWT_SECRET") ?? "demo-development-secret";
