# Migrating

## Own HTTP core (no Elysia)

Techne no longer builds on Elysia. `createApp()` returns Techne's own `App`
(`src/server/`), and the package has no runtime `dependencies`; only TypeBox is
still bundled as source, for schemas.

Most native code keeps working unchanged: `createApp`, `.get()`/`.post()` with
`(path, options, handler)`, `t` schemas, `.use()`, `.decorate()`, `.derive()`,
`.request()`, `.beforeHandle()`, `.afterHandle()`, `.mapResponse()`,
`.error()`, `.afterResponse()`, `.cleanup()`, `.handle()`, `.listen()`,
`.stop()`, `status()` and `problem()`.

Breaking changes:

| Before | After |
| --- | --- |
| `import { Elysia } from "@kaonashi-dev/techne"` | `import { App, createApp } from "@kaonashi-dev/techne"` |
| `@kaonashi-dev/techne/elysia`, `/elysia/*` | Removed. Status helpers and errors are in `@kaonashi-dev/techne/server` |
| `@kaonashi-dev/techne/exact-mirror` | Removed |
| `ValidationError` from `…/elysia` | `ValidationError` from `@kaonashi-dev/techne` |
| `AnyElysia`, `ElysiaConfig` types | `AnyApp`, `AppOptions` |
| `app["~Routes"]` (nested by segment) | `app["~routes"]`, flat: `{ "/users/:id": { get: { body, params, query, headers, response } } }` |
| `createApp({ precompile })`, `aot`, `normalize`, `adapter` | Removed; routes compile on `listen()` or the first request |
| `@elysiajs/*` plugins, Eden treaty | Not supported; write a native plugin (`createApp({ name, as })`) |
| `t.File`, `t.Numeric`, `t.Cookie` and other Elysia `t` extensions | Use TypeBox builders (`t.String`, `t.Number`, ...) |
| `.guard()`, `.group()`, `.macro()`, `.resolve()`, `.state()`, `.model()`, `.ws()`, `.mount()`, `.trace()` | Use `createApp({ prefix })` + `.use()`, `.derive()`, `.decorate()`. WebSockets are not supported yet |

Behaviour changes:

- **Hooks apply regardless of registration order.** A hook covers every route
  of its app and of the apps it mounts, including routes registered before it.
- `as: "scoped"` lifts a hook one level into the parent; `as: "global"` lifts it
  to the root. Decorations always propagate to the parent.
- Response schemas type the route but are not validated at runtime.
- JSON responses use `content-type: application/json;charset=utf-8`.
- Unknown routes, validation failures (422) and unhandled errors (500) are RFC
  9457 `application/problem+json` documents.

The legacy decorator runtime is unaffected; its adapter is now `HttpAdapter`
(`src/platform/http-adapter.ts`), and `ctx.http()` / `app.getHttpAdapter()`
return the Techne `App`. See [Native plugins](./apps/docs/plugins/native-plugins.mdx).

## Toolchain

Techne type-checks with **TypeScript 7** (`typescript@^7`, the native compiler)
and `verbatimModuleSyntax`; the peer dependency is now `typescript >= 7`.
Generated projects pin `typescript@^7.0.2`. TypeScript 7 removes options that
TypeScript 6 deprecated (for example `baseUrl`, `moduleResolution: "node"` and
`target: "es5"`), so update your own `tsconfig.json` if it still uses them.

Lint and format with Bun's built-in tools: replace `oxlint` with `bun lint` and
`oxfmt` with `bun fmt`, and move rule and formatter options from `oxlint.json`
and `.oxfmtrc.json` into the `[lint]` and `[fmt]` sections of `bunfig.toml`.

`bun lint` currently ships in Bun canary only (`bun upgrade --canary`). On stable
Bun, `bun lint` is an alias for `bun run lint`, so a `"lint": "bun lint"` script
calls itself forever. Use `"lint": "techne lint"` instead. It runs the native
linter and exits with an explanation when the Bun version doesn't have one.

## Native composition

The package root now exposes the native composition API. This is a breaking change to
root imports. The decorator runtime is explicitly available at
`@kaonashi-dev/techne/legacy`; `/core` remains a compatibility alias.

```ts
// Existing decorator application
import { TechneFactory } from "@kaonashi-dev/techne/legacy";

// New application
import { createApp, t } from "@kaonashi-dev/techne";
```

### Concept mapping

| Previous architecture | Native composition |
| --- | --- |
| `TechneFactory.create()` + config discovery | `buildApp(dependencies)` + `createApp()` |
| `defineFeature({ controllers, providers })` | Function returning a native app (`createApp()`) |
| `@Controller` / `@Get` / `@Body` | `.get()` / `.post()` with typed native context |
| `@Injectable`, tokens, `Container` | Plain functions/classes with explicit arguments |
| Request-scoped providers | Native `derive` and explicit request data |
| DTO decorators / pipes | Native `t` schemas in route options |
| Guards and response hooks | Native `beforeHandle`, `afterHandle`, `afterResponse` |
| Exception filters | Native `.error(DomainError, handler)`, `problem`, `status` |
| Module lifecycle hooks | `createResources`, native `setup` / `cleanup` |
| `app.close()` | Native `app.stop()`; resource `close()` for handle-only tests |
| Testing module / overrides | Factory arguments with fakes + `app.handle(Request)` |
| Generated RPC route maps | Inferred `ReturnType<typeof buildApp>` |

### Move one feature

```ts
import { createApp, t } from "@kaonashi-dev/techne";

function createUsersService() {
  return { create: (name: string) => ({ name }) };
}

function usersRoutes(users: ReturnType<typeof createUsersService>) {
  return createApp({ prefix: "/users" }).post("/", {
    body: t.Object({ name: t.String({ minLength: 1 }) }),
  }, ({ body }) => users.create(body.name));
}

export function buildApp() {
  return createApp().use(usersRoutes(createUsersService()));
}
```

Then listen explicitly from `main.ts`. Remove `experimentalDecorators` and
`emitDecoratorMetadata` once the application no longer imports decorated code.
Generated projects now follow this structure and do not load `techne.config.ts`.

Native apps use the `(path, options, handler)` route order, and hook methods
without the `on` prefix. Register shutdown work with `cleanup`; `stop` executes
server shutdown. Keep the fluent return type inferred to retain route contracts.

The legacy `config()`, `jwt()`, `mq()`, Prisma, telemetry, Swagger and other DI
integration factories still target the legacy plugin protocol. Native apps must
construct clients explicitly or use native plugins. `/http` is an
independent client and can be used directly. HTTP error defaults now come from
the native core; preserve any old request ID or error-envelope contract explicitly in a
native plugin if your clients rely on it. Health and security policies are
registered explicitly by the application.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and the executable
[`apps/native`](./apps/native) example. Sections below describe previous migrations
and apply to the legacy runtime.

---

Upgrade recipes for Techne's breaking changes live in the docs site:

- **[Migrating](./apps/docs/reference/migrating.mdx)** — the 0.4.0 project
  rename (package name, CLI bin, Redis prefixes, RFC 7807 `type` URLs) and
  the move from interceptors/pipes to response hooks.

For the full, dated list of changes see the [CHANGELOG](./CHANGELOG.md).

> Techne is experimental and pre-1.0 — breaking changes can land between
> minor versions. Pin a version and read the changelog before upgrading.

---

## Elysia 2

> **Superseded** by [Own HTTP core](#own-http-core-no-elysia). This section
> applies only to releases that still ran on Elysia.

Techne built on `elysia@2.0.0-beta.1` and `typebox@1.x`, replacing
`elysia@1.4` and `@sinclair/typebox@0.34`.

> **`elysia@2` is a beta**, published under npm's `next` tag — `latest` is
> still `1.4.x`. Techne pins the exact version rather than using a caret range,
> so a new beta cannot arrive unannounced. Weigh that before shipping to
> production.

### Do I have to change anything?

**No**, if your application only uses Techne's own surface: `@Controller`,
`@Get`, `@Injectable`, DTOs, guards, response hooks, the config loader, the MQ
and queue modules, and the HTTP client. The entire Elysia 2 migration is
absorbed by the framework, and the 830-test suite passes unchanged.

**Yes**, if you do either of the following.

#### 1. You reach through to the Elysia instance

Code that calls `app.getHttpAdapter()` or a plugin's `ctx.http()` and then
registers lifecycle hooks is talking to Elysia directly, and Elysia 2 renamed
every hook by dropping the `on` prefix:

```ts
// before
ctx.http().onRequest((c) => { /* ... */ })
ctx.http().onAfterHandle((c) => { /* ... */ })
ctx.http().onError((c) => { /* ... */ })

// after
ctx.http().request((c) => { /* ... */ })
ctx.http().afterHandle((c) => { /* ... */ })
ctx.http().error((c) => { /* ... */ })
```

Full mapping: `onRequest`→`request`, `onParse`→`parse`,
`onTransform`→`transform`, `onBeforeHandle`→`beforeHandle`,
`onAfterHandle`→`afterHandle`, `onAfterResponse`→`afterResponse`,
`onError`→`error`, `onStart`→`setup`, `onStop`→`cleanup`. `mapResponse` is
unchanged. `resolve` is gone — use `derive`.

Two further traps if you register routes on the Elysia instance yourself:

- **Argument order changed** to `(path, options, handler)`. The old order does
  **not** throw: Elysia treats the options object as the handler and serializes
  it as the response body, so the route silently returns its own schema with a
  `200`. Grep for `.get(`/`.post(` on a raw Elysia instance.
- **`ctx.code` is gone.** Errors are matched by class now:

  ```ts
  // before
  if (ctx.code === "VALIDATION") { /* ... */ }

  // after
  import { ValidationError } from "@kaonashi-dev/techne/elysia"
  if (ctx.error instanceof ValidationError) { /* ... */ }
  ```

#### 2. You import `@sinclair/typebox` directly

Elysia 2 validates against TypeBox 1.x, published as the **`typebox`** package —
not a new major of `@sinclair/typebox`, which is still on `0.34`. A `0.34`
schema handed to an Elysia 2 route is rejected outright with *"Elysia Validator
support only TypeBox and Standard Schema"*, so this is not optional.

```ts
// before
import { Type, type Static, type TSchema } from "@sinclair/typebox"
import { TypeCompiler } from "@sinclair/typebox/compiler"
const validator = TypeCompiler.Compile(schema)

// after
import * as Type from "@kaonashi-dev/techne/typebox/type"
import type { Static, TSchema } from "@kaonashi-dev/techne/typebox"
import { Compile } from "@kaonashi-dev/techne/typebox/compile"
const validator = Compile(schema)
```

`Compile()` returns the same `.Check()` / `.Errors()` surface, so call sites
usually need no further change.

### Validation error payloads changed shape

TypeBox 1.x reports failures in the AJV/JSON-Schema idiom. If you read the
`errors[]` array out of a `422` problem document, or inspect
`ValidationError.constraints`, the field names moved:

| TypeBox 0.34 | TypeBox 1.x     | Notes                                    |
| ------------ | --------------- | ---------------------------------------- |
| `path`       | `instancePath`  | JSON Pointer, e.g. `/items/0/name`       |
| `type`       | `keyword`       | Now a descriptive string, not a numeric enum |
| `value`      | *(removed)*     | Techne repopulates it from the input     |

`ValidationError.constraints` is consequently keyed by strings you can branch
on — `"minLength"`, `"minimum"`, `"type"`, `"required"` — instead of numeric
codes. That is a strict improvement, but it *is* a change if you matched on the
old keys.

One behavioural subtlety Techne normalizes for you: TypeBox 1.x reports **all**
missing required properties as a single error anchored at the parent object,
where 0.34 reported one error per property. Techne fans that back out so each
missing field still gets its own entry.

### Schemas no longer carry TypeBox symbols

If you introspect schemas — walking `Symbol.for("TypeBox.Kind")` or
`Symbol.for("TypeBox.Optional")` to drive codegen or docs — that mechanism is
gone. TypeBox 1.x emits plain, spec-clean JSON Schema.

Techne's own walkers now classify nodes structurally; `src/schema/json-schema-kind.ts`
exports `kindOf`, `requiredKeys`, `unionMembers`, and `tupleMembers` if you want
the same treatment. The key consequence: **optionality is a property of the
parent**, not the node. A lone `{ type: "string" }` cannot tell you whether it
was declared optional — you have to consult the enclosing object's `required`
array.

### Known rough edges in the beta

Found while migrating; none block the upgrade, but they are worth knowing:

- **Short hostnames fail to route.** `app.handle(new Request("http://x/a"))`
  returns `404`; `http://localhost/a` works. Hosts shorter than four characters
  are mis-parsed. Test helpers that synthesize URLs should use `localhost`.
- **`ctx.route` is only set for parameterized routes.** Static routes leave it
  `undefined` and carry the template in `ctx.path`. Techne's telemetry falls
  back accordingly, while still reporting no route for unmatched requests so
  `http.route` stays low-cardinality.
- **Hook bodies are statically analyzed.** Elysia decides which context
  properties to materialize by reading your callback's source. Passing `ctx`
  straight through to a helper hides every access, and the properties that
  helper needs may be missing. Destructure or reference them in the hook body.
- **`exact-mirror` must be `>= 1.2.2`.** An older copy left over from Elysia 1.4
  silently disables the compiled response serializer for `Union` response
  schemas (it warns once per route on boot). Techne now depends on it directly.
- **The AOT build plugin is not wired in.** `elysia/plugin/aot/bun` requires the
  build entry to `export default` an Elysia instance, which a Techne
  `src/main.ts` does not do, and the artifact it produced segfaulted Bun
  1.3.14-canary in testing. Revisit when the beta stabilizes.

### Performance

Measured on this repo's benchmark suite (`bun run bench`), Elysia 1.4 → 2.0-beta.1:

- **Throughput regressed ~4 % geometric mean**, with individual HTTP scenarios
  down 8–15 %. Raw Elysia regressed by a similar 9–11 % on the same machine, so
  this is upstream beta behaviour rather than framework overhead — Techne's
  cost *relative* to raw Elysia is essentially unchanged.
- **Invalid-body validation improved ~38 %**: Elysia 2 materializes errors
  eagerly as an array, so Techne no longer drains an iterator to report the
  first failure.
- **Boot time at scale improved ~24 %** (500 routes: 18.4 ms → 14.0 ms).
- **Resident memory rose** ~59 MB → ~73 MB at rest. Marginal per-route cost is
  slightly lower, so the gap narrows as an app grows.

Re-measure on your own hardware before drawing conclusions:

```sh
bun run bench -- --json > before.json   # on elysia 1.4
bun run bench -- --json > after.json    # on elysia 2
bun run bench:compare before.json after.json --labels "1.4,2.0"
```
