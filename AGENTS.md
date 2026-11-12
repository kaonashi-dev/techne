# AGENTS.md

Techne is a Bun-only TypeScript framework library. The native composition API lives
at the package root; the decorator runtime is legacy and must stay behind explicit
subpaths. Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing composition,
routing, lifecycle, resources, or build behavior.

## Commands

```sh
bun install --frozen-lockfile   # Bun 1.4.4 is pinned in .bun-version; no npm/pnpm
bun test tests/*.test.ts        # full suite; single file: bun test tests/native-app.test.ts
bun run test:types              # native public type contracts (tests/types, apps/native)
bun run typecheck               # src/ and the legacy apps/demo under TypeScript 7
bun run format:check            # bun fmt; printWidth 100, Markdown/JSON ignored
bun run build                   # declarations only -> dist/types (not a bundle)
```

- Before pushing, mirror CI's test job in order: `format:check`, tests, `typecheck`,
  `test:types`, `build`.
- `bun run lint` / `bun run check` go through `techne lint` (`src/cli/lint.ts`),
  which exits 1 on stable Bun because `bun lint` ships only in canary. CI runs lint
  in a separate canary job. Locally skip lint; do not "fix" the lint scripts.
- `bun run bench:native --quick` is the native perf smoke; it does not feed the
  regression gate. The gate is two steps:
  `bun run benchmarks/index.ts --json [--quick] > bench/current.json`, then
  `bun run bench:check --current bench/current.json`. It compares against
  `bench/baseline.json`, and a quick/full mode mismatch is an error. The default
  threshold is 10% because identical runs vary 7–9%. CI points the gate at
  `bench/baseline-ci.json`, which does not exist, so CI skips it. Do not
  recapture the baseline just to silence a real regression.

## Where things live

- Native path: `src/index.ts` → `src/runtime/` (app/resources), `src/server/` (own
  HTTP core), `src/schema/` (own `t` builder). Elysia is gone and TypeBox is no
  longer used or vendored; only deprecated TypeBox-named aliases remain in
  `/contract` and `/swagger`. Historical CHANGELOG entries may still mention both.
- `src/index.ts` must only import the native core. `tests/native-app.test.ts`
  bundles the root and fails if legacy or tooling modules enter the graph. Keep
  decorators, reflection, file discovery, dynamic config loading, and global
  registries out of the native runtime.
- Everything else is outside that graph: legacy decorator runtime (`src/core`,
  `src/factory`, `src/decorators`, `src/platform`), optional integrations
  (`src/mq`, `src/queue`, `src/cqrs`, `src/console`, `src/telemetry`,
  `src/prisma`, `src/testing`), and CLI/tooling (`src/cli`). Legacy apps enter
  through `/legacy` (or the `/core` alias); the other historical subpaths expose
  legacy integrations and are not native plugins.
- Root `tsconfig.json` enables `experimentalDecorators`/`emitDecoratorMetadata`
  for that legacy code. Generated native projects must omit both;
  `tests/cli-generator.test.ts` enforces it.
- Root exports are intentionally minimal and exact-key locked by
  `tests/public-api.test.ts`. Adding one requires updating that test; adding a
  new subpath also requires an `exports` entry in `package.json` (most map to
  `src/<name>/index.ts`).
- The package entry is `src/index.ts` (`module`/`main`/`exports` in
  `package.json`). The top-level `index.ts` is a leftover hello-world stub, and
  `src/main.ts` is a legacy decorator demo that the build excludes. Neither is an
  entry point.
- `apps/native` is the current reference app and deliberately imports `../../../src`
  (do not switch it to `@kaonashi-dev/techne`). `apps/demo` is the legacy
  decorator reference.
- Docs site: `apps/docs` (Mintlify, own package and lockfile). Run
  `cd apps/docs && bun install && bun run dev`. Root `docs/` holds old RFC 7807
  error pages.

## Native conventions

- Return fluent `createApp()` chains from feature factories and export
  `type App = ReturnType<typeof buildApp>`. Annotating `App`/`AnyApp` or using
  `any` erases route inference.
- `app.ts` wires dependencies explicitly; `main.ts` owns env, resource acquisition,
  and signals. Route factories take services explicitly; services depend on the
  narrow ports they use.
- `t` is Techne's own schema builder; schemas are plain JSON Schema. Walk schema
  changes through `src/schema/core/schema-node.ts` and type request state with
  `RuntimeContext`.
- Test HTTP behavior with `app.handle(new Request(...))` (helpers in
  `tests/_helpers/http.ts`), not by starting a listener.
- `createResources` cleanup runs in reverse order, is idempotent, and attempts
  every cleanup; register cleanups during setup.
- The package has zero runtime dependencies; OpenTelemetry and Prisma are optional
  peers. Don't add a runtime dependency for a small helper.

## Testing quirks

- `bun run test` only matches `tests/*.test.ts`. Tests in subdirectories and
  `apps/demo/tests/` are not included; run them explicitly.
- `tests/types/tsconfig.json` has an explicit `include`: `tests/types/*.ts`,
  `tests/native-*.test.ts`, `tests/resources.test.ts`, `apps/native/src`, and
  `benchmarks/native.ts`. A native type-contract test outside those globs must be
  added there or `test:types` will not check it.
- Snapshots live in `tests/__snapshots__/`; update with
  `bun test -u tests/common-constants.test.ts`.
- `tests/cli-generator.test.ts` generates a fresh temp project and runs
  tsc/test/fmt/build/doctor against it (~60s). It is the regression test for
  `src/cli/generators.ts`.
- `test-template-project/` is not referenced by any test or script, and
  `test:nestjs` points at a missing `tests/nestjs/` directory. Neither is a
  reliable template or suite; use the generator and its temp-project test.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.

## Build and deploy

- `bun run build` only emits `.d.ts` files to `dist/types`. Standalone binaries use
  `bun src/cli/index.ts build apps/native/src/main.ts ...`; the stable
  `bun build --compile` binary is the default.
- `--aot` is experimental, cannot cross-compile, interprets `new Function` code
  (schema validators), and needs `--asset` for runtime files. Do not claim `--trim`
  matches a minimal Bun server.
