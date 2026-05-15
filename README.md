# Techne

> Experimental Bun-native application framework using Elysia as the HTTP layer.

Techne is a personal project focused on a decorator-first developer experience, explicit application architecture, and Bun-native runtime ergonomics. It is built for exploration, not production use, and breaking changes should be expected.

## Why Techne

- Bun-first runtime
- Decorator-based controllers and providers with flat feature config
- Built-in dependency injection
- TypeBox-powered request schemas
- CQRS, queues, and testing utilities in one package
- CLI for scaffolding, code generation, and Bun builds

## Installation

```bash
bun add @kaonashi-dev/techne
```

To use the CLI without installing it globally:

```bash
bunx @kaonashi-dev/techne --help
```

## Quick Start

The recommended setup is declarative: a `techne.config.ts` at the project root
holds every framework option, and `main.ts` becomes a one-liner.

```ts
// techne.config.ts
import { defineTechneConfig } from "@kaonashi-dev/techne/core";
import { AppFeature } from "./src/app.module";

export default defineTechneConfig({
  features: [AppFeature],
  port: 3000,
  cors: { origin: true },
});
```

```ts
// src/main.ts
import { bootstrap } from "@kaonashi-dev/techne/core";

await bootstrap();
```

```ts
// src/app.module.ts
import { defineFeature } from "@kaonashi-dev/techne/core";
import { Controller, Get, Injectable } from "@kaonashi-dev/techne/common";

@Injectable()
class AppService {
  getHello() {
    return { message: "Hello from Techne" };
  }
}

@Controller("app")
class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/")
  hello() {
    return this.appService.getHello();
  }
}

export const AppFeature = defineFeature({
  controllers: [AppController],
  providers: [AppService],
});
```

`bootstrap()` reads `techne.config.ts` from `process.cwd()`, calls
`TechneFactory.create()`, and starts listening. Port resolution is
`options.port` → config `port` → `Bun.env.PORT` → `3000`. `host` defaults to
`"0.0.0.0"`. The shorthand `techne()` returns the application without starting
the server.

### Lower-level API

`TechneFactory.create()` is still available and is the right call when you need
full control over the lifecycle (e.g. tests, in-process invocations):

```ts
import { TechneFactory } from "@kaonashi-dev/techne/core";
import { AppFeature } from "./src/app.module";

const app = await TechneFactory.create({ features: [AppFeature] });
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
```

## Techne Surfaces

The recommended mental model is:

- `@kaonashi-dev/techne/common` for decorators, exceptions, DTO/schema helpers, and request lifecycle interfaces.
- `@kaonashi-dev/techne/core` for bootstrap and infrastructure APIs.
- `@kaonashi-dev/techne/config`, `/jwt`, `/swagger`, `/health`, `/testing`, `/cqrs`, and `/mq` for specialized features.

### Import Map

| Area | Package |
| --- | --- |
| Decorators, exceptions, schemas | `@kaonashi-dev/techne/common` |
| Bootstrap, DI container, reflector, config loader | `@kaonashi-dev/techne/core` |
| Testing utilities | `@kaonashi-dev/techne/testing` |
| CQRS buses and event store | `@kaonashi-dev/techne/cqrs` |
| Queue and worker primitives | `@kaonashi-dev/techne/mq` |

### Migration

| Before | After |
| --- | --- |
| `import { Controller } from "@kaonashi-dev/techne";` | `import { Controller } from "@kaonashi-dev/techne/common";` |
| `import { NotFoundException } from "@kaonashi-dev/techne";` | `import { NotFoundException } from "@kaonashi-dev/techne/common";` |
| `import { TechneFactory, Reflector } from "@kaonashi-dev/techne";` | `import { TechneFactory, Reflector } from "@kaonashi-dev/techne/core";` |
| `import { Test } from "@kaonashi-dev/techne";` | `import { Test } from "@kaonashi-dev/techne/testing";` |
| `import { CommandBus } from "@kaonashi-dev/techne";` | `import { CommandBus } from "@kaonashi-dev/techne/cqrs";` |
| `import { Queue } from "@kaonashi-dev/techne";` | `import { Queue } from "@kaonashi-dev/techne/mq";` |

`@kaonashi-dev/techne` is now a minimal bootstrap entrypoint. Use it only when you explicitly want the smallest possible surface.

## Core Concepts

### Features

```ts
import { defineFeature } from "@kaonashi-dev/techne/core";

export const UsersFeature = defineFeature({
  controllers: [UsersController],
  providers: [UsersService],
});
```

### Controllers and Routes

```ts
import { Body, Controller, Get, Param, Post, Query } from "@kaonashi-dev/techne/common";

@Controller("users")
class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("/")
  findAll(@Query("page") page?: string) {
    return this.usersService.findAll(Number(page) || 1);
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post("/", { body: CreateUserSchema })
  create(@Body() body: any) {
    return this.usersService.create(body);
  }
}
```

### Dependency Injection

```ts
import { Inject, Injectable } from "@kaonashi-dev/techne/common";

const API_KEY = Symbol("API_KEY");

@Injectable()
class AuthService {
  constructor(@Inject(API_KEY) private readonly apiKey: string) {}
}

const app = await TechneFactory.create({
  providers: [
    AuthService,
    { provide: API_KEY, useValue: process.env.API_KEY },
  ],
});
```

### Guards and Middleware

```ts
import { Controller, Get, Injectable, Middleware, UseGuards } from "@kaonashi-dev/techne/common";
import type { CanActivate } from "@kaonashi-dev/techne/common";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: any) {
    return context.headers.authorization === "Bearer valid-token";
  }
}

const logMiddleware = async (context: any) => {
  console.log(`${context.request.method} ${context.request.url}`);
};

@Controller("admin")
@UseGuards(AuthGuard)
@Middleware(logMiddleware)
class AdminController {
  @Get("/dashboard")
  dashboard() {
    return { access: "granted" };
  }
}
```

## Validation and DTOs

Techne exposes a `Schema` helper built on `@sinclair/typebox`.

```ts
import { Body, Controller, Post, Schema } from "@kaonashi-dev/techne/common";

const CreateUserSchema = Schema.Object({
  name: Schema.String({ minLength: 2 }),
  email: Schema.String(),
  role: Schema.enum(["admin", "editor", "viewer"] as const),
  age: Schema.Optional(Schema.Integer({ minimum: 0 })),
});

@Controller("users")
class UsersController {
  @Post("/", { body: CreateUserSchema })
  create(@Body() body: any) {
    return body;
  }
}
```

Decorator-style DTO metadata is also available through exports such as `Dto`, `IsString`, `IsNumber`, `IsInteger`, `IsBoolean`, and `IsEnum`. DTO schemas are passed to Elysia directly, so request validation is a single native Elysia pass. DTOs reject unknown properties by default; use `@Dto({ allowAdditional: true })` to opt out.

## Configuration

The preferred entry point is `defineConfig`, which validates env values against
a TypeBox schema at startup and produces a typed `AppConfig` object. It pairs
with `appConfig(config)` so handlers can pull the same object out of
DI via `@InjectConfig()`.

```ts
import { appConfig as appConfigPlugin, defineConfig, InjectConfig, t } from "@kaonashi-dev/techne/config";
import { Controller, Get } from "@kaonashi-dev/techne/common";
import { TechneFactory } from "@kaonashi-dev/techne/core";

const typedConfig = defineConfig({
  schema: t.Object({
    PORT: t.Integer({ minimum: 1, maximum: 65535 }),
    DATABASE_URL: t.String({ minLength: 1 }),
    LOG_LEVEL: t.Optional(t.Union([t.Literal("debug"), t.Literal("info")])),
  }),
});

type Config = typeof typedConfig;

@Controller("status")
class StatusController {
  constructor(@InjectConfig() private readonly config: Config) {}

  @Get("/")
  status() {
    return { port: this.config.get("PORT") };
  }
}

const app = await TechneFactory.create({
  plugins: [appConfigPlugin(typedConfig)],
  controllers: [StatusController],
});
```

Invalid or missing env values throw `ConfigValidationError` before the HTTP
server starts. `t` is a re-export of TypeBox's `Type` for ergonomic schema
authoring, and `APP_CONFIG` is the DI token `@InjectConfig()` resolves.

`config()` registers `ConfigService` from env files, runtime env, and optional
load factories:

```ts
import { ConfigService, config } from "@kaonashi-dev/techne/config";

const app = await TechneFactory.create({
  plugins: [config({ expandVariables: true })],
});
const config = app.get<ConfigService>(ConfigService);
config.getOrThrow("DATABASE_URL");
```

## Runtime Features

Prefer declaring runtime options in `techne.config.ts`. The setters below are
still supported but emit a one-time deprecation warning per process and will
be removed in v1.0:

```ts
const app = await TechneFactory.create({ controllers: [UsersController] });

// Deprecated — declare these in techne.config.ts instead.
app.setGlobalPrefix("api");
app.enableVersioning({ type: "uri" });
app.enableCors({ origin: true, credentials: true });
app.useGlobalGuards(new AuthGuard());
```

The declarative equivalent:

```ts
// techne.config.ts
import { defineTechneConfig } from "@kaonashi-dev/techne/core";

export default defineTechneConfig({
  features: [UsersFeature],
  globalPrefix: "api",
  versioning: { type: "uri" },
  cors: { origin: true, credentials: true },
});
```

`TechneFactory.createApplicationContext()` is also available for standalone flat
provider graphs without HTTP. Request-scoped providers share a stable context
across guards and handlers within the same request through `ContextIdFactory`
from `@kaonashi-dev/techne/core`.

## Plugins

Plugins are the sanctioned extension point. A plugin is a named, optionally
dependency-ordered unit with a single `setup()` function that receives a
`PluginContext` — the only surface allowed to mutate framework state, register
DI tokens, hook into lifecycle, or reach the raw Elysia instance.

```ts
import { definePlugin } from "@kaonashi-dev/techne/core";

interface MetricsOptions {
  prefix?: string;
}

const MetricsPlugin = definePlugin<MetricsOptions>({
  name: "metrics",
  version: "0.1.0",
  dependencies: [],
  setup(ctx, options) {
    const prefix = options?.prefix ?? "techne_";
    ctx.logger.log(`registering metrics with prefix "${prefix}"`);

    ctx.provide("METRICS_PREFIX", prefix);

    ctx.http().get("/metrics", () => `# metrics for ${prefix}\n`);

    ctx.onReady(async () => {
      ctx.logger.log("ready: metrics endpoint live");
    });

    ctx.onShutdown(async () => {
      ctx.logger.log("flushing metrics before exit");
    });
  },
});

const app = await TechneFactory.create({ controllers: [], providers: [] });
await app.register(MetricsPlugin, { prefix: "myapp_" });
```

- `ctx.provide(token, value)` registers a token in the root DI scope.
- `ctx.resolve(token)` reads from the root scope.
- `ctx.onReady(handler)` fires after `onApplicationBootstrap` and before the
  HTTP server starts listening.
- `ctx.onShutdown(handler)` fires in LIFO order during graceful shutdown,
  before the MQ registry closes and before `onModuleDestroy`.
- `ctx.http()` returns the raw Elysia instance for low-level integrations.

Re-registering the same `name` + `setup` function is a no-op (handy for HMR);
a different `setup` for the same `name` throws. Missing `dependencies` throw
at registration time.

Native Elysia plugins can be attached through `app.use()`:

```ts
import { cors } from "@elysiajs/cors";

app.use(cors());
```

`app.getRegisteredPlugins()` returns the list of registered plugin names in
registration order — useful for diagnostics.

## Auth and JWT

```ts
import { APP_GUARD, Public, Roles, RolesGuard } from "@kaonashi-dev/techne/common";
import { Reflector, TechneFactory } from "@kaonashi-dev/techne/core";
import { jwt, JwtAuthGuard, JwtService } from "@kaonashi-dev/techne/jwt";

const app = await TechneFactory.create({
  plugins: [jwt({ secret: "top-secret" })],
  providers: [
    {
      provide: APP_GUARD,
      useFactory: (jwt: JwtService, reflector: Reflector) => [
        new JwtAuthGuard(reflector, jwt),
        new RolesGuard(reflector),
      ],
      inject: [JwtService, Reflector],
    },
  ],
});
```

Use `@Public()` to skip auth and `@Roles(...)` for role metadata consumed by `RolesGuard`.

## Swagger and Health

`SwaggerModule.createAutoDocument(app, builder?)` walks every registered route
(including their TypeBox `params`, `query`, `body`, and `response` schemas) and
emits an OpenAPI 3.1 document — no manual `addPath()` calls required. Anything
the builder adds explicitly takes precedence, so the auto-generated spec can
still be patched without forking.

```ts
import { SwaggerModule, DocumentBuilder } from "@kaonashi-dev/techne/swagger";

const document = SwaggerModule.createAutoDocument(
  app,
  new DocumentBuilder().setTitle("My API").setVersion("1.0.0"),
);

SwaggerModule.setup("/api-docs", app, document);
```

The lower-level pieces are also exported for callers that want to integrate
the emitter directly: `emitOpenApiDocument(app, builder?)` and
`typeboxToOpenApi(schema)` from `@kaonashi-dev/techne/swagger`.

`HealthCheckService` from `@kaonashi-dev/techne/health` still provides
`pingCheck()` and `memoryCheck()` helpers for callers that want to expose a
custom health indicator. The auto-registered `/healthz` and `/readyz`
endpoints described in [Health & Graceful Shutdown](#health--graceful-shutdown)
are independent and are wired up by `TechneFactory.create()`.

## Response Hooks

```ts
import { Controller, Get, OnResponse } from "@kaonashi-dev/techne/common";
import type { ResponseHook } from "@kaonashi-dev/techne/common";

const CacheHeaderHook: ResponseHook = {
  transform(result, context) {
    context.ctx.set.headers = {
      ...(context.ctx.set.headers ?? {}),
      "cache-control": "no-store",
    };
    return result;
  },
};

@Controller("reports")
@OnResponse(CacheHeaderHook)
class ReportsController {
  @Get("/")
  list() {
    return [];
  }
}
```

## Exceptions

Techne serializes exceptions as RFC 7807 problem documents with
`Content-Type: application/problem+json`. Subclasses of `HttpException` accept
an optional second argument that attaches a machine-readable `code` and an
explicit problem `type` URI:

```ts
import { NotFoundException } from "@kaonashi-dev/techne/common";

throw new NotFoundException("User #99 not found", { code: "user.not_found" });
```

The serialized response looks like:

```json
{
  "type": "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "User #99 not found",
  "code": "user.not_found",
  "instance": "/users/99",
  "requestId": "<uuid>"
}
```

`instance` is the request path and `requestId` is propagated from the
`x-request-id` header (or generated on the fly when absent) and echoed back on
the response. `errors` is added on 422 validation failures as a
`ValidationError[]` extension field. In production, `detail` is omitted for
non-`HttpException` throws so server-side error messages never leak to
clients. `REASON_PHRASES` is exported from `@kaonashi-dev/techne/common` for
callers that need the standard HTTP reason-phrase table.

## Testing

Testing utilities live under `./testing`.

```ts
import { Test } from "@kaonashi-dev/techne/testing";

const module = await Test.createTestingModule({
  providers: [UserService, DatabaseService],
})
  .overrideProvider(DatabaseService)
  .useValue({
    find: () => [{ id: 1, name: "Mock User" }],
  })
  .compile();

const userService = module.get<UserService>(UserService);
```

## CQRS

CQRS utilities live under `./cqrs`.

```ts
import {
  Command,
  CommandBus,
  CommandHandler,
  DomainEvent,
  EventBus,
  EventHandler,
} from "@kaonashi-dev/techne/cqrs";

class CreateUserCommand extends Command<{ name: string }> {}

class UserCreatedEvent extends DomainEvent<{ id: number; name: string }> {}

@CommandHandler(CreateUserCommand)
class CreateUserHandler {
  constructor(private readonly eventBus: EventBus) {}

  async execute(command: CreateUserCommand) {
    const user = { id: 1, ...command.payload };
    await this.eventBus.emit(new UserCreatedEvent(user), `user-${user.id}`);
    return user;
  }
}

@EventHandler(UserCreatedEvent)
class UserCreatedLogger {
  handle(event: UserCreatedEvent) {
    console.log("User created:", event.data.name);
  }
}
```

`TechneFactory.create()` registers the command, query, and event buses automatically.

## MQ

Queue utilities now live under `./mq`. The legacy `./queue` subpath remains as a temporary
core-only compatibility layer that reexports `Queue`, `Worker`, `Job`, and `QueueEvents`.

```ts
import {
  InjectMq,
  Job,
  mq,
  MqProcess,
  MqProcessor,
  Queue,
  Worker,
} from "@kaonashi-dev/techne/mq";

const queue = new Queue("emails");

await queue.add("send", { email: "user@example.com" }, { attempts: 3, backoff: 1000 });

@MqProcessor("emails")
class EmailProcessor {
  constructor(@InjectMq("emails") private readonly emails: Queue<{ email: string }>) {}

  @MqProcess("send")
  async send(job: Job<{ email: string }>) {
    return { delivered: job.data.email };
  }
}

const worker = new Worker(queue, async (job) => {
  console.log("Processing:", job.name, job.data);
  return { ok: true };
});

await worker.run();
```

Framework integration is available through the `mq()` plugin:

```ts
const app = await TechneFactory.create({
  plugins: [mq({ queues: [{ name: "emails" }] })],
  providers: [EmailProcessor],
});
```

## Health & Graceful Shutdown

`TechneFactory.create()` auto-registers two health endpoints:

- `GET /healthz` — liveness. Always returns 200 once the process is up.
- `GET /readyz` — readiness. Returns 200 only after `onApplicationBootstrap`
  has completed AND every configured health check resolves to
  `healthy: true`. During shutdown, readiness flips to `false` immediately so
  load balancers can stop routing traffic before in-flight requests drain.

Paths and checks are configurable through the `health` option, and graceful
shutdown is configured through `shutdown`:

```ts
// techne.config.ts
import { defineTechneConfig } from "@kaonashi-dev/techne/core";
import { AppFeature } from "./src/app.module";
import { db } from "./src/db";

export default defineTechneConfig({
  features: [AppFeature],
  health: {
    livenessPath: "/healthz",
    readinessPath: "/readyz",
    checks: [
      async () => ({
        name: "database",
        healthy: await db.ping(),
      }),
    ],
  },
  shutdown: {
    gracePeriod: 15_000,
    signals: ["SIGTERM", "SIGINT"],
  },
});
```

When a configured signal fires, the adapter starts refusing new requests with
HTTP 503 and waits up to `gracePeriod` ms (default `10_000`) for in-flight
work to settle before stopping. Plugin `onShutdown` handlers fire in LIFO
order, then the MQ registry closes, then `onModuleDestroy` runs.

Set `health: { enabled: false }` to opt out of the auto-registered endpoints
entirely.

## CLI

```bash
# Create a new project
bunx @kaonashi-dev/techne new my-project

# Run with hot reload and an optional inspector
bunx @kaonashi-dev/techne dev --port 3000 --inspect

# Run without hot reload (production-style)
bunx @kaonashi-dev/techne start --port 3000

# Run the test suite
bunx @kaonashi-dev/techne test tests/ --watch --coverage

# Diagnose tsconfig / project layout
bunx @kaonashi-dev/techne doctor

# Generate framework files
bunx @kaonashi-dev/techne g module users
bunx @kaonashi-dev/techne g controller users
bunx @kaonashi-dev/techne g service users
bunx @kaonashi-dev/techne g resource users
bunx @kaonashi-dev/techne g middleware logger
bunx @kaonashi-dev/techne g guard auth
bunx @kaonashi-dev/techne g filter http-exception
bunx @kaonashi-dev/techne g dto create-user

# Scaffold a multi-stage Bun Dockerfile (+ .dockerignore)
bunx @kaonashi-dev/techne g docker --port 3000
bunx @kaonashi-dev/techne deploy --target docker --port 3000

# Build an entrypoint with bun build
bunx @kaonashi-dev/techne build src/main.ts --out dist/app.bun --minify
bunx @kaonashi-dev/techne build src/main.ts --target node --out dist/app.js
```

Commands: `new`, `create`, `dev`, `start`, `build`, `test`, `deploy`,
`doctor`, `generate|g`.

Generator types: `module`, `controller`, `service`, `resource`, `middleware`,
`guard`, `filter`, `dto`, `docker`, `client`.

`techne deploy --target docker` currently writes the same multi-stage
Dockerfile as the `g docker` generator. Other deploy targets (`fly`, `railway`,
`cloudflare`, `bun-vm`) are planned but not implemented yet.

Generated starters use `@kaonashi-dev/techne/common` and
`@kaonashi-dev/techne/core` and emit a `bootstrap()` + `techne.config.ts`
project skeleton.

## Package Exports

```ts
import { TechneFactory } from "@kaonashi-dev/techne/core";
import { Controller, Dto, IsString } from "@kaonashi-dev/techne/common";
import { appConfig, config, ConfigService } from "@kaonashi-dev/techne/config";
import { jwt, JwtAuthGuard, JwtService } from "@kaonashi-dev/techne/jwt";
import { SwaggerModule } from "@kaonashi-dev/techne/swagger";
import { HealthCheckService } from "@kaonashi-dev/techne/health";
import { Test } from "@kaonashi-dev/techne/testing";
import { CommandBus } from "@kaonashi-dev/techne/cqrs";
import { mq, Queue } from "@kaonashi-dev/techne/mq";
```

## Scripts

```bash
bun run test
bun run check
bun run build
bun run bench
```

## Project Structure

```text
src/
  cli/            CLI scaffolding and generators
  common/         Public decorators, exceptions, and schema helpers
  config/         ConfigService, config plugins, and registerAs helpers
  core/           Application core, DI container, and bootstrap APIs
    plugins/      Plugin protocol (`definePlugin`, `PluginContext`)
  cqrs/           Command, query, event buses and event store
  decorators/     Routing, DI, and metadata decorators
  exceptions/     HTTP exception classes
  factory/        TechneFactory bootstrap implementation
  health/         Basic health check service and decorator
  jwt/            JWT plugin, service, and auth guard
  mq/             BullMQ-style queue core and framework integration
  platform/       Elysia adapter
  queue/          Legacy core-only queue compatibility barrel
  schema/         TypeBox-backed schema helpers and DTO metadata
  swagger/        Lightweight OpenAPI document generation and setup
  testing/        Testing module utilities
```

## Performance

A benchmark matrix lives under [`benchmarks/`](./benchmarks/README.md) covering
the code paths that actually matter — raw Elysia vs Techne, the arity-specialized
**fast path** for routes with no enhancers, the cost-tagged **slow path** for
routes with guards and filters, schema validation (valid + invalid bodies),
response schemas (exercising the compiled TypeBox stringifier), container
resolution, and cold start with `Bun.spawn`.

```bash
bun run benchmarks/index.ts            # full matrix
bun run benchmarks/index.ts --quick    # CI smoke
bun run benchmarks/index.ts --json     # machine-readable
```

Notable optimizations on the hot path:

- Arity-specialized compiled handlers for routes without enhancers.
- Cost-tagged slow path that hoists static `@Injectable()` guards out at route
  registration time.
- Compiled TypeBox stringifiers (`compileStringifier(schema)` from
  `@kaonashi-dev/techne/schema`) used automatically for routes with a
  `response` schema, with a per-schema `WeakMap` cache.
- Cheaper validation error path and lighter request-id / in-flight tracking.

## Status

Techne is still experimental. APIs may change quickly, some areas are incomplete, and documentation will continue to evolve with the framework.

v0.3 (in progress) introduces declarative config, plugin protocol, RFC 7807
errors, `/healthz` + `/readyz`, graceful shutdown, expanded CLI, and auto
OpenAPI.

## License

MIT
