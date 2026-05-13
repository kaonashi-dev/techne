# Bnest

> Experimental Nest-style framework for Bun, using Elysia as the HTTP layer.

Bnest is a personal project focused on bringing familiar NestJS-style patterns to Bun without a Node.js runtime. It is built for exploration, not production use, and breaking changes should be expected.

## Why Bnest

- Bun-first runtime
- Decorator-based modules, controllers, and providers
- Built-in dependency injection
- TypeBox-powered request schemas
- CQRS, microservices, queues, and testing utilities in one package
- CLI for scaffolding, code generation, and Bun builds

## Installation

```bash
bun add @kaonashi-dev/bnest
```

To use the CLI without installing it globally:

```bash
bunx @kaonashi-dev/bnest --help
```

## Quick Start

The recommended setup is declarative: a `bnest.config.ts` at the project root
holds every framework option, and `main.ts` becomes a one-liner.

```ts
// bnest.config.ts
import { defineBnestConfig } from "@kaonashi-dev/bnest/core";
import { AppModule } from "./src/app.module";

export default defineBnestConfig({
  module: AppModule,
  port: 3000,
  cors: { origin: true },
});
```

```ts
// src/main.ts
import { bootstrap } from "@kaonashi-dev/bnest/core";

await bootstrap();
```

```ts
// src/app.module.ts
import { Controller, Get, Injectable, Module } from "@kaonashi-dev/bnest/common";

@Injectable()
class AppService {
  getHello() {
    return { message: "Hello from Bnest" };
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

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`bootstrap()` reads `bnest.config.ts` from `process.cwd()`, calls
`BnestFactory.create()`, and starts listening. Port resolution is
`options.port` → config `port` → `Bun.env.PORT` → `3000`. `host` defaults to
`"0.0.0.0"`. The shorthand `bnest()` returns the application without starting
the server.

### Lower-level API

`BnestFactory.create()` is still available and is the right call when you need
full control over the lifecycle (e.g. tests, in-process invocations):

```ts
import { BnestFactory } from "@kaonashi-dev/bnest/core";

const app = await BnestFactory.create(AppModule);
app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
```

## Coming from NestJS

The recommended mental model is now:

- `@kaonashi-dev/bnest/common` for decorators, exceptions, pipes, DTO/schema helpers, and request lifecycle interfaces.
- `@kaonashi-dev/bnest/core` for bootstrap and infrastructure APIs.
- `@kaonashi-dev/bnest/config`, `/jwt`, `/swagger`, `/health`, `/testing`, `/cqrs`, `/microservices`, and `/mq` for specialized features.

### Import Map

| NestJS | Bnest |
| --- | --- |
| `@nestjs/common` | `@kaonashi-dev/bnest/common` |
| `@nestjs/core` | `@kaonashi-dev/bnest/core` |
| `@nestjs/testing` | `@kaonashi-dev/bnest/testing` |
| `@nestjs/cqrs` | `@kaonashi-dev/bnest/cqrs` |
| `@nestjs/microservices` | `@kaonashi-dev/bnest/microservices` |

### Migration

| Before | After |
| --- | --- |
| `import { Controller, Module } from "@kaonashi-dev/bnest";` | `import { Controller, Module } from "@kaonashi-dev/bnest/common";` |
| `import { ValidationPipe, NotFoundException } from "@kaonashi-dev/bnest";` | `import { ValidationPipe, NotFoundException } from "@kaonashi-dev/bnest/common";` |
| `import { BnestFactory, Reflector } from "@kaonashi-dev/bnest";` | `import { BnestFactory, Reflector } from "@kaonashi-dev/bnest/core";` |
| `import { Test } from "@kaonashi-dev/bnest";` | `import { Test } from "@kaonashi-dev/bnest/testing";` |
| `import { CommandBus } from "@kaonashi-dev/bnest";` | `import { CommandBus } from "@kaonashi-dev/bnest/cqrs";` |
| `import { Queue } from "@kaonashi-dev/bnest";` | `import { Queue } from "@kaonashi-dev/bnest/mq";` |

`@kaonashi-dev/bnest` is now a minimal bootstrap entrypoint. Use it only when you explicitly want the smallest possible surface.

## Core Concepts

### Modules

```ts
import { Module } from "@kaonashi-dev/bnest/common";

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
class UsersModule {}
```

### Controllers and Routes

```ts
import { Body, Controller, Get, Param, Post, Query } from "@kaonashi-dev/bnest/common";

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
import { Inject, Injectable, Module } from "@kaonashi-dev/bnest/common";

const API_KEY = Symbol("API_KEY");

@Injectable()
class AuthService {
  constructor(@Inject(API_KEY) private readonly apiKey: string) {}
}

@Module({
  providers: [
    AuthService,
    { provide: API_KEY, useValue: process.env.API_KEY },
  ],
})
class AuthModule {}
```

### Guards and Middleware

```ts
import { Controller, Get, Injectable, Middleware, UseGuards } from "@kaonashi-dev/bnest/common";
import type { CanActivate } from "@kaonashi-dev/bnest/common";

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

Bnest exposes a `Schema` helper built on `@sinclair/typebox`.

```ts
import { Body, Controller, Post, Schema } from "@kaonashi-dev/bnest/common";

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

Decorator-style DTO metadata is also available through exports such as `Dto`, `IsString`, `IsNumber`, `IsInteger`, `IsBoolean`, `IsEnum`, and `ValidationPipe`.

## Configuration

The preferred entry point is `defineConfig`, which validates env values against
a TypeBox schema at startup and produces a typed `AppConfig` object. It pairs
with `ConfigModule.forApp(config)` so handlers can pull the same object out of
DI via `@InjectConfig()`.

```ts
import { ConfigModule, defineConfig, InjectConfig, t } from "@kaonashi-dev/bnest/config";
import { Controller, Get, Module } from "@kaonashi-dev/bnest/common";

const appConfig = defineConfig({
  schema: t.Object({
    PORT: t.Integer({ minimum: 1, maximum: 65535 }),
    DATABASE_URL: t.String({ minLength: 1 }),
    LOG_LEVEL: t.Optional(t.Union([t.Literal("debug"), t.Literal("info")])),
  }),
});

type Config = typeof appConfig;

@Controller("status")
class StatusController {
  constructor(@InjectConfig() private readonly config: Config) {}

  @Get("/")
  status() {
    return { port: this.config.get("PORT") };
  }
}

@Module({
  imports: [ConfigModule.forApp(appConfig)],
  controllers: [StatusController],
})
export class AppModule {}
```

Invalid or missing env values throw `ConfigValidationError` before the HTTP
server starts. `t` is a re-export of TypeBox's `Type` for ergonomic schema
authoring, and `APP_CONFIG` is the DI token `@InjectConfig()` resolves.

The legacy `ConfigModule.forRoot()`, `forRootAsync()`, `forFeature()`, `ConfigService`,
and `registerAs()` are still exported from `@kaonashi-dev/bnest/config` for
incremental migration.

```ts
import { ConfigModule, ConfigService, registerAs } from "@kaonashi-dev/bnest/config";

const databaseConfig = registerAs("database", () => ({
  url: process.env.DATABASE_URL ?? "memory://local",
}));

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    ConfigModule.forFeature(databaseConfig),
  ],
})
class LegacyAppModule {}

// later
const config = app.get<ConfigService>(ConfigService);
config.getOrThrow("DATABASE_URL");
```

## Runtime Features

Prefer declaring runtime options in `bnest.config.ts`. The setters below are
still supported but emit a one-time deprecation warning per process and will
be removed in v1.0:

```ts
const app = await BnestFactory.create(AppModule);

// Deprecated — declare these in bnest.config.ts instead.
app.setGlobalPrefix("api");
app.enableVersioning({ type: "uri" });
app.enableCors({ origin: true, credentials: true });
app.useGlobalGuards(new AuthGuard());
```

The declarative equivalent:

```ts
// bnest.config.ts
import { defineBnestConfig } from "@kaonashi-dev/bnest/core";

export default defineBnestConfig({
  module: AppModule,
  globalPrefix: "api",
  versioning: { type: "uri" },
  cors: { origin: true, credentials: true },
});
```

`BnestFactory.createApplicationContext()` is also available for standalone module graphs without HTTP.

Modules now respect `imports`/`exports` boundaries during resolution. Private
providers stay private, `global: true` modules expose only their exported
tokens, and request-scoped providers share a stable context across guards,
interceptors, and handlers within the same request through `ContextIdFactory`
from `@kaonashi-dev/bnest/core`.

## Plugins

Plugins are the sanctioned extension point. A plugin is a named, optionally
dependency-ordered unit with a single `setup()` function that receives a
`PluginContext` — the only surface allowed to mutate framework state, register
DI tokens, hook into lifecycle, or reach the raw Elysia instance.

```ts
import { definePlugin } from "@kaonashi-dev/bnest/core";

interface MetricsOptions {
  prefix?: string;
}

const MetricsPlugin = definePlugin<MetricsOptions>({
  name: "metrics",
  version: "0.1.0",
  dependencies: [],
  setup(ctx, options) {
    const prefix = options?.prefix ?? "bnest_";
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

const app = await BnestFactory.create(AppModule);
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
import { APP_GUARD, Public, Roles, RolesGuard } from "@kaonashi-dev/bnest/common";
import { JwtAuthGuard, JwtModule, JwtService } from "@kaonashi-dev/bnest/jwt";

@Module({
  imports: [JwtModule.register({ secret: "top-secret" })],
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
})
class AuthModule {}
```

Use `@Public()` to skip auth and `@Roles(...)` for role metadata consumed by `RolesGuard`.

## Swagger and Health

`SwaggerModule.createAutoDocument(app, builder?)` walks every registered route
(including their TypeBox `params`, `query`, `body`, and `response` schemas) and
emits an OpenAPI 3.1 document — no manual `addPath()` calls required. Anything
the builder adds explicitly takes precedence, so the auto-generated spec can
still be patched without forking.

```ts
import { SwaggerModule, DocumentBuilder } from "@kaonashi-dev/bnest/swagger";

const document = SwaggerModule.createAutoDocument(
  app,
  new DocumentBuilder().setTitle("My API").setVersion("1.0.0"),
);

SwaggerModule.setup("/api-docs", app, document);
```

The lower-level pieces are also exported for callers that want to integrate
the emitter directly: `emitOpenApiDocument(app, builder?)` and
`typeboxToOpenApi(schema)` from `@kaonashi-dev/bnest/swagger`.

`HealthCheckService` from `@kaonashi-dev/bnest/health` still provides
`pingCheck()` and `memoryCheck()` helpers for callers that want to expose a
custom Nest-style indicator. The auto-registered `/healthz` and `/readyz`
endpoints described in [Health & Graceful Shutdown](#health--graceful-shutdown)
are independent and are wired up by `BnestFactory.create()`.

## File Uploads

```ts
import { FileInterceptor, UploadedFile, UseInterceptors } from "@kaonashi-dev/bnest/common";

@Post("/upload")
@UseInterceptors(FileInterceptor("file"))
upload(@UploadedFile("file") file: any) {
  return { name: file?.name };
}
```

## Exceptions

Bnest serializes exceptions as RFC 7807 problem documents with
`Content-Type: application/problem+json`. Subclasses of `HttpException` accept
an optional second argument that attaches a machine-readable `code` and an
explicit problem `type` URI:

```ts
import { NotFoundException } from "@kaonashi-dev/bnest/common";

throw new NotFoundException("User #99 not found", { code: "user.not_found" });
```

The serialized response looks like:

```json
{
  "type": "https://bnest.dev/errors/not-found",
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
clients. `REASON_PHRASES` is exported from `@kaonashi-dev/bnest/common` for
callers that need the standard HTTP reason-phrase table.

## Testing

Testing utilities live under `./testing`.

```ts
import { Test } from "@kaonashi-dev/bnest/testing";

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
} from "@kaonashi-dev/bnest/cqrs";

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

`BnestFactory.create()` registers the command, query, and event buses automatically.

## Microservices

Microservice utilities live under `./microservices`.

```ts
import { Injectable } from "@kaonashi-dev/bnest/common";
import { BnestFactory } from "@kaonashi-dev/bnest/core";
import { EventPattern, MessagePattern } from "@kaonashi-dev/bnest/microservices";

@Injectable()
class UserMessages {
  @MessagePattern("users.count")
  count() {
    return 42;
  }

  @EventPattern("users.created")
  onCreated(data: { name: string }) {
    console.log("New user:", data.name);
  }
}

const { server, client } = await BnestFactory.createMicroservice(AppModule, {
  transport: "local",
});

await server.listen();
await client.send("users.count", {});
```

Supported transports: `local`, `redis`.

## MQ

Queue utilities now live under `./mq`. The legacy `./queue` subpath remains as a temporary
core-only compatibility layer that reexports `Queue`, `Worker`, `Job`, and `QueueEvents`.

```ts
import {
  InjectMq,
  Job,
  MqModule,
  MqProcess,
  MqProcessor,
  Queue,
  Worker,
} from "@kaonashi-dev/bnest/mq";

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

Framework integration is available through `MqModule.register()` and
`MqModule.registerQueue({ name: "emails" })`.

## Health & Graceful Shutdown

`BnestFactory.create()` auto-registers two health endpoints:

- `GET /healthz` — liveness. Always returns 200 once the process is up.
- `GET /readyz` — readiness. Returns 200 only after `onApplicationBootstrap`
  has completed AND every configured health check resolves to
  `healthy: true`. During shutdown, readiness flips to `false` immediately so
  load balancers can stop routing traffic before in-flight requests drain.

Paths and checks are configurable through the `health` option, and graceful
shutdown is configured through `shutdown`:

```ts
// bnest.config.ts
import { defineBnestConfig } from "@kaonashi-dev/bnest/core";
import { AppModule } from "./src/app.module";
import { db } from "./src/db";

export default defineBnestConfig({
  module: AppModule,
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
bunx @kaonashi-dev/bnest new my-project

# Run with hot reload and an optional inspector
bunx @kaonashi-dev/bnest dev --port 3000 --inspect

# Run without hot reload (production-style)
bunx @kaonashi-dev/bnest start --port 3000

# Run the test suite
bunx @kaonashi-dev/bnest test tests/ --watch --coverage

# Diagnose tsconfig / project layout
bunx @kaonashi-dev/bnest doctor

# Generate framework files
bunx @kaonashi-dev/bnest g module users
bunx @kaonashi-dev/bnest g controller users
bunx @kaonashi-dev/bnest g service users
bunx @kaonashi-dev/bnest g resource users
bunx @kaonashi-dev/bnest g middleware logger
bunx @kaonashi-dev/bnest g guard auth
bunx @kaonashi-dev/bnest g pipe trim
bunx @kaonashi-dev/bnest g filter http-exception
bunx @kaonashi-dev/bnest g interceptor logging
bunx @kaonashi-dev/bnest g dto create-user

# Scaffold a multi-stage Bun Dockerfile (+ .dockerignore)
bunx @kaonashi-dev/bnest g docker --port 3000
bunx @kaonashi-dev/bnest deploy --target docker --port 3000

# Build an entrypoint with bun build
bunx @kaonashi-dev/bnest build src/main.ts --out dist/app.bun --minify
bunx @kaonashi-dev/bnest build src/main.ts --target node --out dist/app.js
```

Commands: `new`, `create`, `dev`, `start`, `build`, `test`, `deploy`,
`doctor`, `generate|g`.

Generator types: `module`, `controller`, `service`, `resource`, `middleware`,
`guard`, `pipe`, `filter`, `interceptor`, `dto`, `docker`, `client`.

`bnest deploy --target docker` currently writes the same multi-stage
Dockerfile as the `g docker` generator. Other deploy targets (`fly`, `railway`,
`cloudflare`, `bun-vm`) are planned but not implemented yet.

Generated starters use `@kaonashi-dev/bnest/common` and
`@kaonashi-dev/bnest/core` and emit a `bootstrap()` + `bnest.config.ts`
project skeleton.

## Package Exports

```ts
import { BnestFactory } from "@kaonashi-dev/bnest/core";
import { Controller, Module, ValidationPipe } from "@kaonashi-dev/bnest/common";
import { ConfigModule } from "@kaonashi-dev/bnest/config";
import { JwtModule } from "@kaonashi-dev/bnest/jwt";
import { SwaggerModule } from "@kaonashi-dev/bnest/swagger";
import { HealthCheckService } from "@kaonashi-dev/bnest/health";
import { Test } from "@kaonashi-dev/bnest/testing";
import { CommandBus } from "@kaonashi-dev/bnest/cqrs";
import { MessagePattern } from "@kaonashi-dev/bnest/microservices";
import { Queue } from "@kaonashi-dev/bnest/mq";
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
  common/         Nest-style public common API barrel
  config/         ConfigModule, ConfigService, and registerAs helpers
  core/           Application core, DI container, and bootstrap APIs
    plugins/      Plugin protocol (`definePlugin`, `PluginContext`)
  cqrs/           Command, query, event buses and event store
  decorators/     Routing, DI, and metadata decorators
  exceptions/     HTTP exception classes
  factory/        BnestFactory bootstrap implementation
  health/         Basic health check service and decorator
  jwt/            JWT module, service, and auth guard
  mq/             BullMQ-style queue core and framework integration
  microservices/  Local and Redis transports
  platform/       Elysia adapter
  queue/          Legacy core-only queue compatibility barrel
  schema/         TypeBox-backed schema helpers and DTO metadata
  swagger/        Lightweight OpenAPI document generation and setup
  testing/        Testing module utilities
```

## Performance

A benchmark matrix lives under [`benchmarks/`](./benchmarks/README.md) covering
the code paths that actually matter — raw Elysia vs Bnest, the arity-specialized
**fast path** for routes with no enhancers, the cost-tagged **slow path** for
routes with guards/interceptors/pipes, validation (valid + invalid bodies),
response schemas (exercising the compiled TypeBox stringifier), container
resolution, and cold start with `Bun.spawn`.

```bash
bun run benchmarks/index.ts            # full matrix
bun run benchmarks/index.ts --quick    # CI smoke
bun run benchmarks/index.ts --json     # machine-readable
```

Notable optimizations on the hot path:

- Arity-specialized compiled handlers for routes without enhancers.
- Cost-tagged slow path that hoists static `@Injectable()` guards/interceptors
  out at route registration time.
- Compiled TypeBox stringifiers (`compileStringifier(schema)` from
  `@kaonashi-dev/bnest/schema`) used automatically for routes with a
  `response` schema, with a per-schema `WeakMap` cache.
- Cheaper validation error path and lighter request-id / in-flight tracking.

## Status

Bnest is still experimental. APIs may change quickly, some areas are incomplete, and documentation will continue to evolve with the framework.

v0.3 (in progress) introduces declarative config, plugin protocol, RFC 7807
errors, `/healthz` + `/readyz`, graceful shutdown, expanded CLI, and auto
OpenAPI.

## License

MIT
