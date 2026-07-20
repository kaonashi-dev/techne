# Dependency Upgrade Roadmap — Elysia 2 readiness + full stable refresh

**Status: PLANNED.** Reviews the current dependency tree, refreshes every dependency to its
latest **stable** release now, and prepares a concrete migration path to **Elysia 2** for when
it ships a stable release.

> This plan **replaces** the prior (completed) HTTP Client plan, which remains in git history
> (`dcf1ef4 feat(http): add Laravel-style outgoing HTTP client`).

---

## Context: what the review found

### Elysia 2 is not stable yet

As of 2026-07-20 on npm:

| dist-tag       | version        |
| -------------- | -------------- |
| `latest`       | **1.4.29**     |
| `next`         | 2.0.0-exp.9    |
| `experimental` | 2.0.0-exp.46   |

Elysia v2 exists **only as experimental builds** (`2.0.0-exp.*`). There is no stable 2.x, no
changelog entry for 2.0 (not even on the `next` branch), and no published migration guide.
Pinning a framework dependency to an `-exp` build would put every Techne consumer on an
unversioned moving target — **we should not ship on it**.

What the `2.0.0-exp.46` package metadata already tells us about the breaking surface:

- **TypeBox 1.x**: peer dependency changes from `@sinclair/typebox >= 0.34 < 1` to
  **`typebox >= 1.3.0`** — the renamed, rewritten TypeBox v1 package. This is the single
  biggest migration item for Techne (see Phase 2).
- Peers tighten: `typescript >= 5.7`, `@types/bun >= 1.3`, `openapi-types >= 12`.
- Internals swapped: `memoirist` 0.4 → 1.2 (router), `exact-mirror` 0.2 → 1.2 (response
  mirroring), `deuri` replaces `fast-decode-uri-component`, `cookie` dropped. Expect changed
  perf characteristics and cookie behavior — our bench gate and cookie-signing tests matter.

### Techne's Elysia coupling is narrow, but its TypeBox coupling is wide

Direct `elysia` imports (the whole runtime surface):

| File | What it uses |
| ---- | ------------ |
| `src/platform/elysia-adapter.ts` (864 lines) | `new Elysia({ cookie })`, fused `onRequest` / `onAfterHandle` / `onError` hooks, `app.handle()`, and **behavioral assumptions**: hook ordering (`onRequest` runs before `derive`), per-request `ctx.store` shaping, raw-`Response` short-circuits bypassing after-hooks |
| `src/schema/index.ts`, `src/schema/enum.ts` | `t` (re-exported TypeBox builder) |
| `src/telemetry/request-span.ts` | `StatusMap` |
| `tests/plugin-protocol.test.ts`, `benchmarks/http.ts`, `benchmarks/fast-path.ts` | `Elysia` constructor for harnesses/comparisons |

Direct `@sinclair/typebox` imports (much broader — this is where Elysia 2's TypeBox v1 jump
bites): `src/schema/dto.ts`, `src/schema/fast-stringify.ts`, `src/core/router/router-execution-context.ts`,
`src/mq/define-queue.ts`, `src/mq/dispatch-validation.ts`, `src/config/define-config.ts`,
`src/cli/generators.ts` (generated code), plus tests. Heavy use of `TypeCompiler` /
`TypeCheck` from `@sinclair/typebox/compiler`, which TypeBox 1.x replaces with a new
`typebox/compile` API.

### Current vs latest versions

Baseline verified before writing this plan: **816 tests pass** across 87 files; CI also gates
lint, format, a quick bench matrix with a ±5% regression check, and `tsc` build.

| Package | Current | Latest stable | Jump |
| ------- | ------- | ------------- | ---- |
| `elysia` | ^1.4.28 | **1.4.29** | patch (multipart perf fix) |
| `@sinclair/typebox` | ^0.34.48 | **0.34.52** | patch |
| `@opentelemetry/api` | 1.9.1 | 1.9.1 | none |
| `@opentelemetry/exporter-{trace,metrics}-otlp-http` | 0.219.0 | **0.220.0** | minor |
| `@opentelemetry/{resources,sdk-metrics,sdk-trace-base,sdk-trace-node}` | 2.8.0 | **2.9.0** | minor |
| `@opentelemetry/semantic-conventions` | 1.41.1 | **1.43.0** | minor |
| `prisma`, `@prisma/client` (dev) | ^5 | **7.9.0** | **two majors** |
| `@types/bun` | ^1.3.11 | 1.3.14 | patch (range already covers) |
| `oxlint` | ^1.56.0 | **1.74.0** | minor (new rules likely) |
| `oxfmt` | ^0.41.0 | **0.59.0** | large pre-1.0 jump (reformat churn likely) |
| `typescript` (peer, unpinned) | ^5 → resolves 5.9.3 | 7.0.2 exists | **stay on 5.x** — TS 7 is the new native compiler; peer range `^5` is correct for consumers |

---

## Recommendation: two phases

Ship Phase 1 now. Phase 2 is written down so the moment Elysia 2 goes stable we execute a
prepared migration instead of discovering the surface then.

## Phase 1 — refresh everything on stable ranges (do now)

### 1.1 Runtime deps

- `elysia` `^1.4.28` → `^1.4.29`
- `@sinclair/typebox` `^0.34.48` → `^0.34.52`

Both patch-level; `bun.lock` refresh + full test/bench gates.

### 1.2 OpenTelemetry (dev + peer)

- Exporters `0.219.0` → `0.220.0`; SDK packages + `resources` `2.8.0` → `2.9.0`;
  `semantic-conventions` `1.41.1` → `1.43.0`; `api` stays `1.9.1`.
- Peer ranges (`>=0.200.0`, `>=2.0.0`, `>=1.30.0`) already admit these — no peer changes.
- Re-run `tests/telemetry*.test.ts` — #67 hardened OTel correctness; verify no
  semconv attribute renames leak into `request-span.ts`.

### 1.3 Prisma 5 → 7 (dev deps only)

The integration is deliberately decoupled: `src/prisma` duck-types the client
(`PrismaClientLike`) and lazily `import("@prisma/client")`; tests inject fake importers and
never load a generated client. So the **runtime** risk is near zero. The real work:

- Bump dev `prisma` / `@prisma/client` `^5` → `^7`; peer `>=5` stays unchanged (it already
  admits 7).
- Prisma 7 replaces the legacy `prisma-client-js` generator (client no longer emitted into
  `node_modules/@prisma/client` by default; `prisma.config.ts` replaces `package.json`/schema
  config blocks). Audit the places that mention the old flow:
  - `src/prisma/client-loader.ts` install-hint error message (`bunx prisma generate`),
  - CLI scaffolding in `src/cli/generators.ts`,
  - `test-template-project/` and `apps/docs` Prisma pages.
- Add a doc note that consumers on a custom-output generated client should use the existing
  `clientFactory` option (already the escape hatch — no API change needed).

### 1.4 Toolchain (`oxlint`, `oxfmt`)

- `oxlint` `^1.56` → `^1.74`, `oxfmt` `^0.41` → `^0.59`.
- Expect new lint findings and formatter churn. Land as **two separate commits**: (1) version
  bumps + `bun run check:fix` mechanical churn, (2) any hand-fixes for new lint rules — keeps
  review tractable.

### 1.5 Gates (per commit, matching CI)

```
bun install && bun run lint && bun run format:check && bun test tests/*.test.ts
bun run benchmarks/index.ts --quick --json > bench/current.json
bun run scripts/bench-check.ts --baseline bench/baseline-ci.json --current bench/current.json --threshold 0.05
bun run build
```

## Phase 2 — Elysia 2 migration (blocked on stable release)

**Trigger:** `elysia@2.x` published under the `latest` dist-tag with a changelog/migration
guide. Until then, optionally run the spike below to de-risk.

### 2.1 TypeBox v1 migration (the big one)

Elysia 2 pins `typebox >= 1.3.0` — the renamed package. A single install cannot hold both
worlds cleanly since `t` from `elysia` will be TypeBox 1.x while Techne's own `Schema`/DTO
layer sits on `@sinclair/typebox` 0.34. Work items:

- Swap `@sinclair/typebox` → `typebox` in `package.json` and all 8+ importing modules.
- Port `TypeCompiler.Compile` / `TypeCheck` usages (`schema/dto.ts`, `mq/*`,
  `config/define-config.ts`, `core/router/router-execution-context.ts`) to the TypeBox 1.x
  compile API; re-verify `schema/fast-stringify.ts` against the new schema representation.
- Update `src/cli/generators.ts` templates and docs that emit `@sinclair/typebox` imports.

### 2.2 Adapter re-validation (`src/platform/elysia-adapter.ts`)

The adapter's perf work encodes Elysia-1 behavioral assumptions that must be re-proven on 2.x:

- Hook ordering: fused `onRequest` runs first; `derive` runs after `onRequest` (why store
  shaping is done inline); `onAfterHandle`/`onError` fusion and single inflight decrement.
- Raw `Response` short-circuits (CORS preflight 204, draining 503) bypassing after-hooks.
- Cookie signing config passed to the constructor (`cookie` dropped as an internal dep in
  exp builds — verify the jar API and HMAC behavior survive).
- `app.handle()` semantics used by `src/testing` and the adapter tests.
- `StatusMap` export continuity (`src/telemetry/request-span.ts`).

### 2.3 Perf re-baseline

v2 swaps the router (`memoirist` 1.2) and response mirror (`exact-mirror` 1.x). Run the full
bench suite, then **regenerate `bench/baseline-ci.json`** in the same PR — comparing v2
numbers against a v1 baseline would make the ±5% gate meaningless.

### 2.4 Contract/type surface

`src/contract` route-map types and `src/testing` helpers compile against Elysia's exported
types — re-check inference under the 2.x type rewrite and the `typescript >= 5.7` peer floor
(our `^5` peer range may need a `>=5.7` floor bump in the same release).

### 2.5 Optional de-risking spike (can start today)

On a throwaway branch: `bun add elysia@experimental typebox` and compile only
`src/platform/elysia-adapter.ts` + `src/schema` against it. Goal is a findings list (what
breaks, what's renamed), not shippable code. Timebox: one day.

### 2.6 Release/versioning

Elysia 2 + TypeBox 1 changes Techne's own peer expectations → this is a **breaking Techne
release**. Add a `MIGRATING.md` / `apps/docs/reference/migrating.mdx` entry (per repo
convention) covering: new peer ranges, TypeBox import rename for consumers using
`Schema`/DTO helpers, and any adapter-visible behavior changes.

---

## Sequencing

| # | Work | Depends on |
| - | ---- | ---------- |
| 1 | Phase 1.1–1.3 version bumps + lock refresh, full gates | — |
| 2 | Phase 1.4 toolchain bumps (separate commits for churn vs fixes) | 1 |
| 3 | Docs touch-ups for Prisma 7 flow | 1 |
| 4 | (Optional) Phase 2.5 spike, findings appended to this plan | — |
| 5 | Phase 2.1–2.6 execution | Elysia 2 stable release |
