# Techne

> Experimental Bun-native application framework using Elysia as the HTTP layer.

Techne is a personal project focused on a decorator-first developer experience, explicit application architecture, and Bun-native runtime ergonomics. It is built for exploration, not production use, and breaking changes should be expected.

**Full documentation lives in the Mintlify site at [`apps/docs/`](./apps/docs/).** Run it locally with `cd apps/docs && bun run dev`, or browse the `.mdx` sources directly on GitHub. This README is intentionally a landing page — the docs site is the canonical reference.

## Why Techne

- Bun-first runtime with Elysia as the HTTP layer
- Decorator-based controllers and providers with flat feature config
- Built-in dependency injection with request and transient scopes
- TypeBox-powered request schemas and DTO validation
- RFC 7807 problem documents for every HTTP error
- Laravel-style outgoing HTTP client with test fakes
- CQRS, message queues, console commands, and testing utilities in one package
- Opt-in OpenTelemetry tracing and metrics
- Optional Prisma integration and typed RPC contract clients
- Security toolkit: headers, CSRF, rate limiting, signed cookies
- CLI for scaffolding, code generation, and Bun builds

## Installation

Techne is not published to a registry yet. Install directly from GitHub:

```bash
bun add github:kaonashi-dev/techne
```

To pin to a specific tag or commit:

```bash
bun add "github:kaonashi-dev/techne#<tag-or-sha>"
```

To scaffold a new project without a prior install:

```bash
bunx github:kaonashi-dev/techne new my-project
```

Your project's `tsconfig.json` must enable decorator support:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
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

```bash
bun run src/main.ts
curl http://localhost:3000/app
# → {"message":"Hello from Techne"}
```

See the [Quickstart](./apps/docs/quickstart.mdx) for the step-by-step version
and the lower-level `TechneFactory.create()` API.

## Import Map

Techne ships as a set of subpath imports so unused subsystems add no overhead:

| Area                                              | Package                          |
| ------------------------------------------------- | -------------------------------- |
| Minimal bootstrap entrypoint                      | `@kaonashi-dev/techne`           |
| Decorators, exceptions, schemas                   | `@kaonashi-dev/techne/common`    |
| Bootstrap, DI container, reflector, config loader | `@kaonashi-dev/techne/core`      |
| Configuration service and helpers                 | `@kaonashi-dev/techne/config`    |
| JWT auth plugin and guard                         | `@kaonashi-dev/techne/jwt`       |
| OpenAPI / Swagger document generation             | `@kaonashi-dev/techne/swagger`   |
| Health checks and readiness                       | `@kaonashi-dev/techne/health`    |
| Outgoing HTTP client                              | `@kaonashi-dev/techne/http`      |
| OpenTelemetry tracing and metrics                 | `@kaonashi-dev/techne/telemetry` |
| CQRS buses and event store                        | `@kaonashi-dev/techne/cqrs`      |
| Queue and worker primitives                       | `@kaonashi-dev/techne/mq`        |
| Prisma ORM integration                            | `@kaonashi-dev/techne/prisma`    |
| Typed RPC contract client and codegen             | `@kaonashi-dev/techne/contract`  |
| Security primitives (headers, CSRF, rate limit)   | `@kaonashi-dev/techne/security`  |
| Console (CLI) command subsystem                   | `@kaonashi-dev/techne/console`   |
| Testing utilities                                 | `@kaonashi-dev/techne/testing`   |
| Legacy queue compatibility layer                  | `@kaonashi-dev/techne/queue`     |

## Documentation

| Topic | Docs |
| ----- | ---- |
| Getting started | [Introduction](./apps/docs/introduction.mdx) · [Installation](./apps/docs/installation.mdx) · [Quickstart](./apps/docs/quickstart.mdx) · [Project structure](./apps/docs/project-structure.mdx) |
| Concepts | [Features](./apps/docs/concepts/features.mdx) · [Controllers](./apps/docs/concepts/controllers.mdx) · [Dependency injection](./apps/docs/concepts/dependency-injection.mdx) · [Application lifecycle](./apps/docs/concepts/application-lifecycle.mdx) |
| Configuration | [techne.config.ts](./apps/docs/configuration/techne-config.mdx) · [Typed environment](./apps/docs/configuration/environment.mdx) |
| HTTP | [Routing](./apps/docs/http/routing.mdx) · [Middleware](./apps/docs/http/middleware.mdx) · [Guards](./apps/docs/http/guards.mdx) · [Validation](./apps/docs/http/validation.mdx) · [Response hooks](./apps/docs/http/response-hooks.mdx) · [Exceptions](./apps/docs/http/exceptions.mdx) · [CORS](./apps/docs/http/cors.mdx) · [HTTP client](./apps/docs/http/client.mdx) |
| Plugins | [Plugin protocol](./apps/docs/plugins/plugin-protocol.mdx) · [Elysia plugins](./apps/docs/plugins/using-elysia-plugins.mdx) |
| Auth | [JWT](./apps/docs/auth/jwt.mdx) · [Roles](./apps/docs/auth/roles.mdx) |
| ORM (Prisma) | [Getting started](./apps/docs/orm/getting-started.mdx) |
| Swagger | [Auto document](./apps/docs/swagger/auto-document.mdx) · [Custom document](./apps/docs/swagger/custom-document.mdx) |
| Health | [Endpoints](./apps/docs/health/endpoints.mdx) · [Graceful shutdown](./apps/docs/health/graceful-shutdown.mdx) |
| Observability (telemetry) | [OpenTelemetry](./apps/docs/observability/opentelemetry.mdx) · [Instrumenting code](./apps/docs/observability/instrumenting-code.mdx) |
| Testing | [Overview](./apps/docs/testing/overview.mdx) |
| CQRS | [Overview](./apps/docs/cqrs/overview.mdx) |
| MQ (queues) | [Overview](./apps/docs/mq/overview.mdx) |
| Contract (typed RPC) | [RPC client](./apps/docs/contract/rpc-client.mdx) · [Codegen](./apps/docs/contract/codegen.mdx) |
| Console commands | [Overview](./apps/docs/console/overview.mdx) |
| CLI | [Overview](./apps/docs/cli/overview.mdx) |
| Errors (RFC 7807) | [Overview](./apps/docs/errors/overview.mdx) |
| Performance | [Benchmarks](./apps/docs/performance/benchmarks.mdx) · [Optimizations](./apps/docs/performance/optimizations.mdx) |
| Migrating to 0.4 | [Migration guide](./apps/docs/reference/migrating.mdx) (also [MIGRATING.md](./MIGRATING.md)) |

## Exceptions

Every HTTP error is serialized as an RFC 7807 problem document with a `type`
URL of the form
`https://github.com/kaonashi-dev/techne/blob/main/docs/errors/<slug>.md`
(see [`docs/errors/`](./docs/errors/)). The `HttpException` API and its
per-status subclasses are documented in
[Exceptions](./apps/docs/http/exceptions.mdx).

## Repository Scripts

```bash
bun test           # framework test suite
bun run lint       # oxlint
bun run bench      # benchmark suite
bun run build      # tsc build
```

The demo application in [`apps/demo/`](./apps/demo/) exercises most framework
features end-to-end and includes an `oha` performance harness.

## Status

Techne is still experimental. APIs may change quickly, some areas are
incomplete, and documentation will continue to evolve with the framework.

The latest release is **0.4.0** (project renamed to Techne) — see the
[CHANGELOG](./CHANGELOG.md) and the [migration guide](./MIGRATING.md).

## License

MIT
