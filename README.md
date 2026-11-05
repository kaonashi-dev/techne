# Techne

**Explicit application composition, built for Bun.**

Techne provides a small application wrapper, resource ownership and feature-oriented
scaffolding on its own small HTTP core. Dependencies are TypeScript arguments,
business logic is ordinary code, and there are no runtime dependencies. The
project is experimental.

## Quick start

```sh
bun add github:kaonashi-dev/techne
```

```ts
import { createApp, t } from "@kaonashi-dev/techne";

const greeting = { hello: (name: string) => ({ message: `Hello, ${name}` }) };

const app = createApp()
  .get("/hello/:name", {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
  }, ({ params }) => greeting.hello(params.name))
  .listen(3000);
```

`createApp()` returns a Techne `App`: routes with `(path, options, handler)`,
`t` schemas for `body`, `query`, `params` and `headers`, typed context,
lifecycle hooks (`request`, `derive`, `beforeHandle`, `afterHandle`,
`mapResponse`, `error`, `afterResponse`), composition with `.use()`, cookies and
RFC 9457 problem responses. Synchronous routes never allocate an async frame.

## Architecture

```text
main.ts          acquire infrastructure → compose → listen → close
  └─ app.ts      explicitly wire services and feature plugins
      └─ feature/routes.ts  HTTP schemas, policies and response mapping
          └─ feature/service.ts  business rules and typed dependency ports
              └─ infrastructure adapter supplied by app.ts
```

```ts
// features/users/users.routes.ts
import { createApp } from "@kaonashi-dev/techne";

interface UsersService {
  find(id: string): { id: string; name: string };
}

export function usersRoutes(users: UsersService) {
  return createApp({ prefix: "/users" })
    .get("/:id", ({ params }) => users.find(params.id));
}
```

```ts
// app.ts
import { createApp } from "@kaonashi-dev/techne";
import { usersRoutes } from "./features/users/users.routes";

export function buildApp() {
  const users = { find: (id: string) => ({ id, name: "Ada" }) };
  return createApp().use(usersRoutes(users));
}

export type App = ReturnType<typeof buildApp>;
```

Return the fluent chain from feature factories so TypeScript retains the complete
route contract. Testing uses the same factories with fake dependencies and
`app.handle(new Request(...))`.

### Resource ownership

```ts
import { Database } from "bun:sqlite";
import { createResources } from "@kaonashi-dev/techne";

const resources = await createResources((onClose) => {
  const database = new Database(":memory:");
  onClose(() => database.close());
  return { database };
});

// Pass resources.value.database to your repository factory.
// Register app.cleanup(resources.close) before listen(); close explicitly if boot fails.
await resources.close();
```

Setup failures roll back registered resources. Closing is idempotent, runs in
reverse acquisition order, and attempts every cleanup. `await using` is supported.

## Scaffold a project

```sh
bunx github:kaonashi-dev/techne new my-app
```

The starter has `src/app.ts`, `src/main.ts`, a feature with a plain service, an HTTP
test, strict TypeScript, and Docker deployment. In the generated project:

```sh
bun install
bun run dev
bun test
bun run check
bunx techne g resource users
```

Mount generated features explicitly in `app.ts`. See the runnable reference in
[`apps/native/`](./apps/native/) and the [architecture guide](./ARCHITECTURE.md).

## Public surface

| Import | Purpose |
| --- | --- |
| `@kaonashi-dev/techne` | `createApp`, `App`, `createResources`, `t`, `status`, `problem`, `ValidationError` |
| `@kaonashi-dev/techne/server` | HTTP core internals: `StatusMap`, `HttpError`, `NotFoundError`, `ParseError`, `problemResponse`, … |
| `@kaonashi-dev/techne/http` | Independent outgoing HTTP client |
| `@kaonashi-dev/techne/legacy` | Decorator runtime: `TechneFactory`, container and legacy bootstrap |
| `@kaonashi-dev/techne/core` | Compatibility alias for the legacy runtime |

`t` is Techne's own small JSON Schema builder in `src/schema/core/`; schemas are
plain objects and can be inspected or reused as ordinary JSON Schema.

Existing decorator-oriented integration subpaths remain available for legacy
applications. Their plugin protocol requires the legacy runtime; native apps use
native plugins or explicitly constructed clients. The root imports only the HTTP
core and the resource utility. See [migration details](./MIGRATING.md#native-composition).

## Documentation and verification

- [Architecture and contribution rules](./ARCHITECTURE.md)
- [Quickstart](./apps/docs/quickstart.mdx)
- [Migration](./MIGRATING.md)
- [Native performance methodology](./apps/docs/native-performance.mdx)
- [Changelog](./CHANGELOG.md)

```sh
bun install --frozen-lockfile
bun run build
bun run test:types
bun test tests/*.test.ts
bun run check
bun run bench:native           # in-process comparison with a hand-written fetch handler
bun run apps/native/src/main.ts
```

The docs site in `apps/docs/` separates the current API from the legacy reference.
The older `apps/demo/` exercises the decorator runtime.

## License

MIT
