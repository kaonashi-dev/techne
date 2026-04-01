# Bnest

> **This is a personal project and experiment.** Bnest is not production-ready and is built purely for learning and exploration purposes. It aims to replicate core NestJS patterns natively on Bun using Elysia.js as the HTTP layer. Expect breaking changes, missing features, and rough edges.
>

## What is Bnest?

Bnest is a lightweight, decorator-based framework for building server-side applications on [Bun](https://bun.sh). It mirrors the NestJS developer experience — modules, controllers, services, dependency injection, guards, middleware, CQRS, and microservices — without the Node.js overhead.

**Key differences from NestJS:**
- Runs natively on **Bun** (not Node.js)
- Uses **Elysia.js** as the HTTP engine (not Express/Fastify)
- Uses **@sinclair/typebox** for schema validation (not class-validator)
- Zero-config — no build step needed for development
- Minimal dependency footprint (3 runtime deps)

## Installation

```bash
bun add bnest
```

## Quick Start

```ts
import { BnestFactory, Module, Controller, Get, Injectable } from "bnest";

@Injectable()
class AppService {
  getHello() {
    return { message: "Hello from Bnest!" };
  }
}

@Controller("app")
class AppController {
  constructor(private appService: AppService) {}

  @Get("/")
  hello() {
    return this.appService.getHello();
  }
}

@Module({
  controllers: [AppController],
  providers: [AppService],
})
class AppModule {}

const app = BnestFactory.create(AppModule);

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
```

## CLI

```bash
# Create a new project
bunx kaonashi-dev/bnest new my-project
cd my-project && bun install && bun run dev

# Generate files
bunx bnest g module users
bunx bnest g controller users
bunx bnest g service users
bunx bnest g resource users    # module + controller + service with CRUD

# Build
bunx bnest build src/main.ts --out dist/app.bun --minify
```

`bnest new` scaffolds a ready-to-run project with `src/main.ts`, `src/app.module.ts`, `src/app.controller.ts`, `src/app.service.ts`, `.gitignore`, `tsconfig.json`, `oxlint.json`, `.oxfmtrc.json`, and common scripts for build, lint, format, and checks.

## Core Concepts

### Modules

Modules organize the application into cohesive blocks.

```ts
import { Module } from "bnest";

@Module({
  imports: [DatabaseModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
class UserModule {}
```

### Controllers & Routes

```ts
import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query } from "bnest";

@Controller("users")
class UserController {
  constructor(private userService: UserService) {}

  @Get("/")
  findAll(@Query("page") page?: string) {
    return this.userService.findAll(Number(page) || 1);
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.userService.findOne(id);
  }

  @Post("/", { body: CreateUserSchema })
  create(@Body() body: any) {
    return this.userService.create(body);
  }
}
```

### Dependency Injection

Bnest supports constructor-based DI with automatic resolution, custom providers, and token-based injection.

```ts
import { Injectable, Inject } from "bnest";

// Class-based (auto-resolved)
@Injectable()
class UserService {
  constructor(private db: DatabaseService) {}
}

// Token-based injection
const API_KEY = Symbol("API_KEY");

@Injectable()
class AuthService {
  constructor(@Inject(API_KEY) private apiKey: string) {}
}

// Custom providers
@Module({
  providers: [
    AuthService,
    { provide: API_KEY, useValue: process.env.API_KEY },
    { provide: "CACHE", useClass: RedisCacheService },
    { provide: "DB_URL", useFactory: (config: ConfigService) => config.get("db.url"), inject: [ConfigService] },
    { provide: "LOGGER", useExisting: ConsoleLogger },
  ],
})
class AppModule {}
```

### Guards

```ts
import { Injectable, UseGuards } from "bnest";
import type { CanActivate } from "bnest";

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: any): boolean {
    return context.headers.authorization === "Bearer valid-token";
  }
}

@Controller("admin")
@UseGuards(AuthGuard)
class AdminController {
  @Get("/dashboard")
  dashboard() {
    return { access: "granted" };
  }
}
```

### Middleware

```ts
import { Controller, Middleware } from "bnest";

const logMiddleware = async (context: any) => {
  console.log(`${context.request.method} ${context.request.url}`);
};

@Controller("api")
@Middleware(logMiddleware)
class ApiController {}
```

### Lifecycle Hooks

Providers and controllers can implement lifecycle hooks:

```ts
@Injectable()
class DatabaseService {
  async onModuleInit() {
    // Called when the module is initialized
    await this.connect();
  }

  async onModuleDestroy() {
    // Called when the module is being destroyed
    await this.disconnect();
  }

  async onApplicationBootstrap() {
    // Called after all modules are initialized
    await this.runMigrations();
  }
}
```

## Schema Validation

Built on `@sinclair/typebox` — no direct imports needed:

```ts
import { Schema } from "bnest";

const CreateUserSchema = Schema.Object({
  name: Schema.String({ minLength: 2 }),
  email: Schema.String(),
  role: Schema.enum(["admin", "editor", "viewer"] as const),
  age: Schema.Optional(Schema.Integer({ minimum: 0 })),
});

@Post("/", { body: CreateUserSchema })
create(@Body() body: any) {
  return this.userService.create(body);
}
```

### Available Schema Builders

| Builder | Description |
|---|---|
| `Schema.Object(props)` | Object with typed properties |
| `Schema.String(opts?)` | String with optional constraints |
| `Schema.Number(opts?)` | Number with optional constraints |
| `Schema.Integer(opts?)` | Integer with optional constraints |
| `Schema.Boolean()` | Boolean |
| `Schema.Literal(value)` | Exact literal value |
| `Schema.enum(values)` | Enum from TS enum or `as const` array |
| `Schema.Union(...)` | Union of schemas |
| `Schema.Optional(schema)` | Mark property as optional |
| `Schema.Partial(schema)` | All properties optional |
| `Schema.Required(schema)` | All properties required |
| `Schema.Pick(schema, keys)` | Pick specific keys |
| `Schema.Omit(schema, keys)` | Omit specific keys |
| `Schema.Array(item)` | Array of items |
| `Schema.Record(key, value)` | Key-value record |
| `Schema.Tuple(...)` | Fixed-length tuple |
| `Schema.Any()` / `Schema.Unknown()` | Escape hatches |

## HTTP Exceptions

```ts
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  TooManyRequestsException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "bnest";

throw new NotFoundException("User not found");
// → { statusCode: 404, error: "Not Found", message: "User not found" }
```

## CQRS

Command-Query Responsibility Segregation with event sourcing:

```ts
import {
  Command, CommandHandler,
  CqrsQuery, QueryHandler,
  DomainEvent, EventHandler,
  CommandBus, QueryBus, EventBus,
} from "bnest";

// Commands
class CreateUserCommand extends Command<{ name: string }> {}

@CommandHandler(CreateUserCommand)
class CreateUserHandler {
  constructor(private eventBus: EventBus) {}

  async execute(command: CreateUserCommand) {
    const user = { id: 1, ...command.payload };
    await this.eventBus.emit(new UserCreatedEvent(user), `user-${user.id}`);
    return user;
  }
}

// Queries
class ListUsersQuery extends CqrsQuery<void, string[]> {}

@QueryHandler(ListUsersQuery)
class ListUsersHandler {
  execute() {
    return ["Alice", "Bob"];
  }
}

// Events
class UserCreatedEvent extends DomainEvent<{ id: number; name: string }> {}

@EventHandler(UserCreatedEvent)
class UserCreatedLogger {
  handle(event: UserCreatedEvent) {
    console.log("User created:", event.data.name);
  }
}
```

Buses are auto-registered by `BnestFactory.create()` and available for injection via `CommandBus`, `QueryBus`, `EventBus`, and `InMemoryEventStore`.

## Microservices

```ts
import { MessagePattern, EventPattern, BnestFactory } from "bnest";

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

const { server, client } = BnestFactory.createMicroservice(AppModule, {
  transport: "local", // or "redis"
});

await server.listen();
const count = await client.send("users.count", {});
await client.emit("users.created", { name: "Ada" });
```

**Available transports:** `local` (in-process), `redis` (distributed pub/sub)

## Job Queues

```ts
import { MemoryQueue, DBQueue, Worker } from "bnest";

// In-memory queue
const queue = new MemoryQueue();

// Or SQLite-backed persistent queue
const queue = new DBQueue("jobs.sqlite");

await queue.enqueue({ email: "user@example.com" });

const worker = new Worker(queue, async (job) => {
  console.log("Processing:", job.payload);
});

worker.start();
```

## Testing

Bnest provides a `TestingModule` that mirrors NestJS's testing approach with isolated containers:

```ts
import { Test } from "bnest";

const module = await Test.createTestingModule({
  providers: [UserService, DatabaseService],
})
  .overrideProvider(DatabaseService)
  .useValue({
    find: () => [{ id: 1, name: "Mock User" }],
  })
  .compile();

const userService = module.get<UserService>(UserService);
expect(userService.findAll()).toEqual([{ id: 1, name: "Mock User" }]);
```

Each `TestingModule` creates a fully isolated DI container — no shared state between tests.

### Override Options

```ts
// Override with a mock value
.overrideProvider(Service).useValue(mockService)

// Override with a different class
.overrideProvider(Service).useClass(MockService)

// Override with a factory
.overrideProvider(Service).useFactory({ factory: () => new MockService() })
```

## Build

```bash
# Bun standalone binary
bun run build

# Node.js ESM module
bun run build:node
```

## Project Structure

```
src/
  core/           # DI container, module scanner
  decorators/     # @Module, @Controller, @Injectable, @Get, @Post, @Inject, etc.
  factory/        # BnestFactory — application bootstrap
  platform/       # Elysia HTTP adapter
  testing/        # TestingModule for unit testing
  cqrs/           # CommandBus, QueryBus, EventBus, EventStore
  microservices/  # Local and Redis transports
  queue/          # Job queue with Memory, SQLite, and Redis adapters
  exceptions/     # HTTP exception classes
  schema/         # Typebox schema builder wrapper
  services/       # Logger
  cli/            # Project scaffolding and code generation
```

## License

MIT
