# Native reference application

From the repository root:

```sh
bun install --frozen-lockfile
bun run apps/native/src/main.ts
```

```sh
curl -X POST http://localhost:3000/users -H 'content-type: application/json' -d '{"name":"Ada"}'
curl http://localhost:3000/users/<returned-id>
curl http://localhost:3000/healthz
```

`src/app.ts` is the composition root. The users service depends on a repository
interface and an ID generator. The memory adapter stores data per app instance;
the route factory performs native validation and maps HTTP responses.

The example uses relative imports to exercise the checked-out framework. In an
installed project use `@kaonashi-dev/techne` instead. No separate install is needed.

Verify with `bun test tests/native-example.test.ts` and `bun run test:types`.
See [ARCHITECTURE.md](../../ARCHITECTURE.md) for resource ownership and migration.
