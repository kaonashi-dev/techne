# Techne

**Explicit application composition on native Elysia, built for Bun.**

Techne provides a small application wrapper, resource ownership and feature-oriented
scaffolding. Routes are Elysia routes, dependencies are TypeScript arguments, and
business logic is ordinary code. The project is experimental and currently pins
`elysia@2.0.0-beta.1`.

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

`createApp()` returns an actual Elysia instance. It enables `precompile: true`
before listening and accepts Elysia's native configuration. Native plugins,
schema inference, cookies, streaming, hooks and typed route contracts remain
available. **Elysia 2 takes `(path, options, handler)` when using route options.**

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
| `@kaonashi-dev/techne` | `createApp`, `createResources`, native `Elysia`, `t`, `status`, `problem` |
| `@kaonashi-dev/techne/http` | Independent outgoing HTTP client |
| `@kaonashi-dev/techne/legacy` | Decorator runtime: `TechneFactory`, container and legacy bootstrap |
| `@kaonashi-dev/techne/core` | Compatibility alias for the legacy runtime |

Existing decorator-oriented integration subpaths remain available for legacy
applications. Their plugin protocol requires the legacy runtime; native apps use
Elysia plugins or explicitly constructed clients. The root imports only Elysia and
the resource utility. See [migration details](./MIGRATING.md#native-composition).

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
bun run bench:native           # in-process comparison with raw Elysia
bun run apps/native/src/main.ts
```

The docs site in `apps/docs/` separates the current API from the legacy reference.
The older `apps/demo/` exercises the decorator runtime.

## License

MIT
