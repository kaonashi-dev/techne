# Native composition architecture

## Decision

Techne's public root is an Elysia-native composition layer. Elysia owns HTTP
registration, context, validation, response serialization and the server.
Techne owns application conventions, project generation and resource cleanup.

The request path is:

```text
Bun → Elysia compiled route/hooks → handler → service → repository
```

Dependencies are resolved by normal function calls during composition. There is
no Techne route dispatcher, request container, parameter binder, metadata scan,
response serializer or mandatory global hook on this path.

## Core API and implementation boundaries

| Surface | Responsibility | Implementation |
| --- | --- | --- |
| `createApp(options?)` | Construct native Elysia, default `precompile: true` | `src/runtime/create-app.ts` |
| `createResources(setup)` | Acquire and dispose app-owned resources | `src/runtime/create-resources.ts` |
| `Elysia`, `t`, `status`, `problem` | Native HTTP primitives, re-exported unchanged | Elysia |
| Feature factory | Receive dependencies and return an Elysia chain | Application code |
| Service factory or plain class | Business rules, with explicit dependencies | Application code |

`src/index.ts` must only import Elysia and `src/runtime/`. Runtime code must not
import the container, decorators, scanner, router adapter, CLI or optional
integrations. Existing legacy code lives behind `/legacy` and historical
subpaths. Legacy integration factories are not Elysia plugins.

## Application layout

```text
src/
  main.ts                       # process, environment, resource acquisition, listen
  app.ts                        # composition root; exports buildApp(dependencies)
  features/
    users/
      users.routes.ts           # schemas, HTTP policies, service invocation
      users.service.ts          # business rules, dependency interfaces
  infrastructure/
    postgres-users.ts           # implements the feature's repository interface
tests/
  users.test.ts                 # service behavior or HTTP boundary with fakes
```

Keep a feature small initially. Add schema files, domain models or use-case files
when they improve navigation. A feature does not need a framework module class,
registration token, base service, or an interface for every function.

### Dependency direction

1. Services depend on data and small capability interfaces they actually use.
2. Infrastructure implements those interfaces and owns vendor-specific details.
3. Route factories depend on services; HTTP context stays at this boundary.
4. `app.ts` wires the graph explicitly and mounts each feature with `.use()`.
5. `main.ts` owns process-level resources, environment and signal handling.

A missing dependency is a TypeScript error at the composition root. Cycles must
be broken through a shared use case or a narrow port. Request identity and
transactions are passed explicitly to the operations that require them.

### Type inference

Return the Elysia method chain directly. Annotating a feature's return type as
`Elysia` or `AnyElysia` erases its route contract. Avoid mutating an untyped array
of plugins in a loop when an explicit `.use(featureA()).use(featureB())` chain
can retain the complete API type.

```ts
export function buildApp(dependencies: Dependencies) {
  const users = createUsersService(dependencies.users, dependencies.nextId);
  return createApp().use(usersRoutes(users));
}
export type App = ReturnType<typeof buildApp>;
```

Native Elysia clients can consume `App` using a client version compatible with
the pinned Elysia version. Techne does not generate a second route type system.

## HTTP and cross-cutting concerns

This repository pins **Elysia 2.0.0-beta.1**. Its options-first route API is
`.post(path, { body, response, beforeHandle }, handler)`. Lifecycle methods use
`request`, `beforeHandle`, `afterHandle`, `afterResponse`, `error`, `setup` and
`cleanup`. `stop()` stops a listening server; `cleanup()` registers shutdown work.

- **Validation:** use native `t` schemas at the HTTP boundary. Preserve domain
  invariants in the service so non-HTTP callers obey them too.
- **Authorization:** apply native `beforeHandle` or `guard` within the feature
  or group it protects. Request-specific identity belongs in `derive`, never
  in a shared service or Elysia's application-wide store.
- **Errors:** return native `status`/`problem` or map domain errors using
  `.error(DomainError, handler)`. Native problem documents use RFC 9457. The
  old mandatory RFC 7807 extensions/request IDs are not installed automatically.
- **Plugins:** use Elysia plugins directly. Scope hooks deliberately; use a
  global hook only for a genuinely app-wide policy. Register policy plugins
  before routes. Named plugins deduplicate in Elysia: use distinct names/seeds
  when mounting differently configured instances.
- **Configuration:** parse environment once in `main.ts`, validate it explicitly,
  and pass values to factories. Importing a feature should not start a server or
  read a config file from the current working directory.
- **Database/queues:** acquire the real client/worker at startup, pass its narrow
  capabilities to services, and register its cleanup. Worker entrypoints compose
  the same services without creating an HTTP application.
- **Observability, CORS, security, OpenAPI:** opt-in native plugins compatible
  with the pinned Elysia version. No universal request interceptor is installed.
- **Health:** register liveness explicitly; readiness should check the specific
  dependencies required by that application.
- **Tests:** instantiate services with fakes, and use `app.handle(Request)` for
  HTTP integration. There is no testing container or provider override API.

## Resource lifecycle

`createResources` provides deterministic ownership independently of HTTP. Setup
is awaited before the application starts serving; register cleanup immediately
after each successful acquisition, during setup. Acquire dependent resources in
order so reverse registration order is also the right shutdown order.

```ts
const resources = await createResources(async (onClose) => {
  const database = await connectDatabase(config.databaseUrl);
  onClose(() => database.close());
  const worker = await startWorker(database);
  onClose(() => worker.stop());
  return { database, worker };
});

try {
  const app = buildApp(resources.value)
    .cleanup(resources.close)
    .listen({ port: config.port, hostname: config.host });

  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= Promise.resolve(app.stop()));
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
} catch (error) {
  await resources.close();
  throw error;
}
```

The lifecycle contract is:

- Setup failure rolls back every cleanup already registered.
- `close()` returns the same promise on repeated/concurrent calls.
- Cleanups run sequentially in reverse registration order, even after a failure.
- Cleanup failures are returned as `AggregateError`; setup plus rollback failure
  preserves both failures and sets the setup failure as `cause`.
- `await using resources = await createResources(...)` supports scoped tests and
  jobs. A long-running server owns resources until shutdown, not until boot returns.
- Elysia drains requests on `stop()` before `cleanup` handlers. For handle-only
  tests or a listen failure, explicitly close resources: there is no running
  server to stop. Cleanup callbacks should not call their own resource scope's
  `close()` recursively.

Process signal policy and shutdown deadlines belong to the executable entrypoint.
No library import installs signal handlers or changes global logging state.

## Performance contract

`createApp` is a constructor-time function. It returns native Elysia and does not
wrap handlers, `fetch`, `handle`, `listen` or serialization. `createResources`
runs during setup/shutdown only. `precompile: true` asks Elysia to compile before
listening, trading startup work for less first-request compilation; users can
override it.

`benchmarks/native.ts` compares raw Elysia and Techne with identical route
builders, options, dependencies and hooks. It checks response parity before
timing, warms up both implementations, alternates order between scenarios, and
reports static JSON, parameter/service, validated-body and guard cases. These
are in-process measurements; socket throughput, cold import cost and deployment
memory are separate measurements. No speedup percentage is part of the API promise.

## Migration boundary

The default API, generated apps and reference example use this architecture.
The decorator runtime remains available through `/legacy`; `/core` remains a
compatibility alias. `/common`, the old DI integrations, `apps/demo`, old
benchmark matrices and their regression tests document that runtime. Their
presence does not add them to the native root's import graph.

Remove legacy features from an application incrementally by rewriting each
controller as a native route factory, constructing its service explicitly, and
replacing legacy plugin registration with native plugins or clients. The two
plugin protocols are distinct; do not pass a `PluginDefinition` to `.use()`.

## Rules for contributors and agents

1. Begin at `app.ts` to understand the dependency graph; follow a feature's routes
   to its service and then the supplied infrastructure adapter.
2. Prefer a native Elysia capability over a new framework abstraction.
3. Keep the public root independent of legacy code and optional integrations.
4. Never erase inferred route types with broad annotations or `any` in new APIs.
5. Create app-specific mutable state inside factories; pass request state as data.
6. Keep decorators, reflection, file discovery and global registries out of the
   native runtime and generated code.
7. Verify route type contracts, real Request/Response behavior, resource failures,
   and generated-project compilation when changing those boundaries.
