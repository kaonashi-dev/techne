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

```ts
import { BnestFactory, Controller, Get, Injectable, Module } from "@kaonashi-dev/bnest";

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
class AppModule {}

const app = await BnestFactory.create(AppModule);

app.listen(3000, () => {
  console.log("Server running at http://localhost:3000");
});
```

## Core Concepts

### Modules

```ts
import { Module } from "@kaonashi-dev/bnest";

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
import { Body, Controller, Get, Param, Post, Query } from "@kaonashi-dev/bnest";

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
import { Inject, Injectable, Module } from "@kaonashi-dev/bnest";

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
import { Controller, Get, Injectable, Middleware, UseGuards } from "@kaonashi-dev/bnest";
import type { CanActivate } from "@kaonashi-dev/bnest";

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
import { Body, Controller, Post, Schema } from "@kaonashi-dev/bnest";

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

Decorator-style DTO metadata is also available through exports such as `Dto`, `IsString`, `IsNumber`, `IsInteger`, `IsBoolean`, and `IsEnum`.

## Exceptions

```ts
import { NotFoundException } from "@kaonashi-dev/bnest";

throw new NotFoundException("User not found");
```

## Testing

Testing utilities are available from the main package and the `./testing` export.

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

CQRS utilities are available from the main package and the `./cqrs` export.

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

Microservice utilities are available from the main package and the `./microservices` export.

```ts
import { BnestFactory, Injectable } from "@kaonashi-dev/bnest";
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

## Queues

Queue utilities are available from the main package and the `./queue` export.

```ts
import { DBQueue, MemoryQueue, Worker } from "@kaonashi-dev/bnest/queue";

const queue = new MemoryQueue();
// const queue = new DBQueue("jobs.sqlite");

await queue.enqueue({ email: "user@example.com" });

const worker = new Worker(queue, async (job) => {
  console.log("Processing:", job.payload);
});

worker.start();
```

## CLI

```bash
# Create a new project
bunx @kaonashi-dev/bnest new my-project

# Generate framework files
bunx @kaonashi-dev/bnest g module users
bunx @kaonashi-dev/bnest g controller users
bunx @kaonashi-dev/bnest g service users
bunx @kaonashi-dev/bnest g resource users

# Build an entrypoint with bun build
bunx @kaonashi-dev/bnest build src/main.ts --out dist/app.bun --minify
bunx @kaonashi-dev/bnest build src/main.ts --target node --out dist/app.js
```

## Package Exports

```ts
import { BnestFactory } from "@kaonashi-dev/bnest";
import { Test } from "@kaonashi-dev/bnest/testing";
import { CommandBus } from "@kaonashi-dev/bnest/cqrs";
import { MessagePattern } from "@kaonashi-dev/bnest/microservices";
import { MemoryQueue } from "@kaonashi-dev/bnest/queue";
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
  core/           Application core and DI container
  cqrs/           Command, query, event buses and event store
  decorators/     Routing, DI, and metadata decorators
  exceptions/     HTTP exception classes
  factory/        BnestFactory bootstrap APIs
  microservices/  Local and Redis transports
  platform/       Elysia adapter
  queue/          In-memory and SQLite-backed queues
  schema/         TypeBox-backed schema helpers and DTO metadata
  testing/        Testing module utilities
```

## Status

Bnest is still experimental. APIs may change quickly, some areas are incomplete, and documentation will continue to evolve with the framework.

## License

MIT
