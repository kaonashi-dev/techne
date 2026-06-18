import type { Feature } from "../../../src/core/index.ts";
import type { Provider } from "../../../src/common/index.ts";
import { jwt } from "../../../src/jwt/index.ts";
import { mq } from "../../../src/mq/index.ts";
import { JWT_SECRET, appConfigPlugin } from "./config/app.config";
import { MetricsPlugin } from "./plugins/metrics.plugin";
import { API_KEY, BUILD_INFO, type BuildInfo } from "./tokens";
import { UsersFeature } from "./users/users.module";
import { AuthFeature } from "./auth/auth.module";
import { CqrsFeature } from "./cqrs/cqrs.module";
import { MqFeature } from "./mq/mq.module";
import { MiscFeature } from "./misc/misc.module";
import { EmailQueue } from "./mq/email.queue";

/** Every feature module the demo registers. */
export const appFeatures: Feature[] = [
  UsersFeature,
  AuthFeature,
  CqrsFeature,
  MqFeature,
  MiscFeature,
];

/** Global providers shared across features: a `useValue` and a `useFactory`. */
export const appProviders: Provider[] = [
  { provide: API_KEY, useValue: "demo-api-key-1234567890" },
  {
    provide: BUILD_INFO,
    useFactory: (): BuildInfo => ({ startedAt: new Date().toISOString(), node: process.version }),
  },
];

/** Plugins: typed config, JWT, the memory-backed MQ, and a custom metrics plugin. */
export const appPlugins = [
  appConfigPlugin,
  jwt({ secret: JWT_SECRET }),
  mq({ queues: [EmailQueue] }),
  MetricsPlugin,
];
