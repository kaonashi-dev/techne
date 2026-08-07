import { defineTechneConfig } from "../../src/core/index.ts";
import { appFeatures, appPlugins, appProviders } from "./src/app.module";

/**
 * Declarative configuration for the whole application. Every runtime knob the
 * framework exposes is set here; `main.ts` just reads this and starts listening.
 */
export default defineTechneConfig({
  features: appFeatures,
  providers: appProviders,
  plugins: appPlugins,

  port: Number(Bun.env.PORT ?? 3000),
  host: "0.0.0.0",

  // Routing
  globalPrefix: "api",
  globalPrefixOptions: { exclude: ["/metrics", "/healthz", "/readyz"] },
  versioning: { type: "uri", prefix: "v", defaultVersion: "1" },
  cors: { origin: ["http://localhost:3000"], credentials: true },

  // Security
  securityHeaders: true,
  rateLimit: { limit: 200, windowMs: 60_000, burst: 250, exclude: ["/healthz", "/readyz"] },
  cookies: { secrets: Bun.env.COOKIE_SECRET ?? "demo-cookie-secret", sign: ["session"] },
  csrf: {},

  // Validation: strip unknown body props globally (per-DTO settings still win)
  validation: { stripUnknown: true },

  // Native server limits
  server: { maxRequestBodySize: 8 * 1024 * 1024, idleTimeout: 30 },

  // Observability
  logger: { mode: "pretty", minLevel: "log", redact: ["password", "accessToken"] },

  // Health + graceful shutdown
  health: {
    livenessPath: "/healthz",
    readinessPath: "/readyz",
    checks: [async () => ({ name: "memory", healthy: true })],
  },
  shutdown: { gracePeriod: 10_000, signals: ["SIGTERM", "SIGINT"] },
});
