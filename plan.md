# Techne — Framework Performance Plan

## Goal & context

Close the gap to raw Elysia on the fast path, eliminate the validation-error throughput cliff, drop the cold-start curve, and remove unnecessary per-request work. Every item is gated on the matrix in `benchmarks/index.ts` (now wired as `bun run bench`).

## Acceptance criteria

Per-scenario targets to hit by the end of the plan, on the same machine that produced the baseline (`bench/baseline.json`):

| Scenario                                | Baseline (Mac, May 16) | Target            | Cumulative (post phase-1) |
|-----------------------------------------|------------------------|-------------------|--------------------------|
| Fast path, plain JSON                   | ~528 k rps             | ≥ 90 % of Elysia  | ~556 k rps (+5%)         |
| Response schema (typed, stringifier)    | ~266 k rps             | ≥ plain JSON      | ~309 k rps (+16%)        |
| Validation, valid body                  | ~279 k rps             | hold              | ~349 k rps (+24%)        |
| Validation, invalid body                | ~98 k rps              | ≥ 0.8 × valid rps | ~137 k rps (+40%) ✅      |
| Slow path (static guard) vs. fast path  | (gap unknown)          | ≤ 10 % gap        | gap measured; B7 pending |
| DI warm lookup                          | ≥ 1 µs                 | ≤ 1 µs / call     | ~0.04 µs ✅              |
| Cold start, N=50                        | ~46 ms                 | sublinear in N    | ~8.7 ms ✅                |

## Baseline & guardrails

- `bench/baseline.json` committed (captured pre-changes on this machine).
- `scripts/bench-check.ts` runs the matrix and fails on any row > 5% rps drop vs. the baseline.
- `package.json` `bench` script now points at `benchmarks/index.ts`. Added `bench:quick`, `bench:check`.
- CI runs `--quick` matrix and the gate (gate is a no-op until a CI-machine baseline lands as `bench/baseline-ci.json`).

---

## Status — completed (21 / 21)

Phase-1 cumulative benchmark above; final pending items are implemented locally and need a full matrix re-measure before updating the acceptance rows.

### Phase A
- **A1 — Response wrapping fast-path** (PR #25). `compileHandler` now emits two distinct closures (with vs. without response work); `maybeStringify` short-circuits `Response`/non-object/null before any try/catch.
- **A2 — Validation error first-only** (PR #27). Default returns `errors: [first]` via `error.valueError`; opt-in `validation: { exhaustive: true }`; `PROBLEM_JSON_HEADERS` hoisted to module scope.
- **A3 — Request-id gated** (PR #30). Boot-time `needsRequestId` flag; `requestId` installed as a lazy self-rewriting getter on first read.
- **A4 — Fused Elysia hooks** (PR #33). 10 → 3 first-party hook registrations on a fully-featured boot.
- **A5 — Compile-time fast/slow closure pick** (PR #34). 3 closure variants chosen at boot; `cache.handler` indirection enables recompile on `setGlobalFilters`.
- **A6 — Fixed-shape per-request store init** (PR #38). Dropped the `ctx.store ?? (ctx.store = {})` coalesce at 4 sites; `app.derive` runs too late so the store is assigned at the top of the fused `onRequest`.

### Phase B
- **B1 — `new Function`-emitted compiled handler** (PR #36). Env-gated (`TECHNE_COMPILED_HANDLERS=1`); covers `@Body`/`@Param`/`@Query`/`@Headers`/`@Req`; falls through to bind-based fast path for `@UploadedFile`, custom param factories, etc.
- **B2 — Symbol-keyed `ControllerDescriptor`** (PR #32). One property read replaces 9 reflect-meta lookups per controller + 6 per handler; legacy reflect path still works for third-party decorators.
- **B3 — Version-gated global filter merge** (PR #37). `globalFiltersVersion` + `globalGuardsVersion` counters skip the partition work when nothing changed.
- **B4 — Request start timestamp on `ctx.store`**. Request logging now stores `Bun.nanoseconds()` on the fixed-shape request store (`startUs`) instead of using a per-request `WeakMap` set/get/delete.
- **B5+B6 — Cached error templates** (PR #28). `IS_PRODUCTION` resolved once at module load; RFC 7807 problem body+headers cached per `(status, slug)`.
- **B7 — Fused guard `beforeHandle`**. Route guard registration now emits one fused guard hook per guarded route, preserving sync fall-through and only resolving contextual guards on the slow path.

### Phase C
- **C3 — ASCII string fast-path in fast-stringify** (PR #24). `__isAsciiSafe` predicate; ASCII strings skip `JSON.stringify` escape.
- **C4 — Static container fast-table** (PR #31). Warm `container.get(token)` is one `Map.get`; token-granular invalidation on every mutation site.
- **C1 — Stage-3 decorator metadata store**. Framework metadata now writes to `target[Symbol.metadata]` by default with `TECHNE_LEGACY_DECORATORS=1` retaining the WeakMap write path for one release; controller descriptors live under `class[Symbol.metadata].techne`.
- **C2 — AOT route table precompile**. `techne build --precompile` writes `.techne/routes.json`; zero-arg `TechneFactory.create()` consumes it when the source hash matches and falls back to live discovery otherwise.

### Phase D
- **D1 — Scanner stable arrays, factory single flatten** (PR #26). `getControllers()`/`getProviders()` return insertion-ordered arrays directly; features walked once.
- **D2 — Phased + parallel plugin registration** (PR #35). `ready: "before-routes" | "before-listen"`; intra-phase Kahn topo-sort and `Promise.all` per layer.
- **D3 — In-process cold-start scenario** (PR #29). New `benchmarks/cold-start-handle.ts`; isolates framework boot from Bun startup. ~40× delta at N=1.

### Tooling
- **Baseline + guardrails** (PR #23). `bench/baseline.json`, `scripts/bench-check.ts`, CI smoke + gate.
- **A7 — CORS hot path**. Dynamic CORS origins now use a per-origin merged-header cache; echo-any origins are capped at 64 LRU entries. Added `benchmarks/cors.ts` to the matrix.

---

## Pending (0 items)

None.

### Open follow-ups (not new plan items)
- The regression gate's "missing rows" warnings come from cold-start labels that embed wall-time (`avg ms = 8.2, wall 54.4`); these never match across runs. Stable label needed in `benchmarks/cold-start.ts` so the gate can diff cold-start rows.
- Capture `bench/baseline-ci.json` from a CI run on `main` so the CI gate stops being a no-op.
- Re-run the full matrix for a single cumulative diff vs. baseline; mark each acceptance row green or red.
- Update the `project_bnest_refactor_roadmap` memory once C1+C2 ship.

---

## Out-of-scope (called out so they don't get rolled in)

- **OpenAPI emitter optimization** — runs at boot once, not in the hot path.
- **Logger formatting** — only relevant when logging is enabled and not on the bench path.
- **`@kaonashi-dev/techne` → `@techne` rename / monorepo split** — separate refactor session per the roadmap memory.

## Sequencing of remaining work

```
All plan items are implemented locally. C2 followed C1 as required.
```

## Definition of done

- All seven matrix rows hit the acceptance targets above.
- Each PR includes the before/after matrix in its description (currently posted as a cumulative diff after merge — see plan §Status table).
- `package.json` bench script and the README point at the matrix runner. ✅
- `bench/baseline.json` committed; CI gate fails on > 5 % regression on any row. ✅ (CI baseline still pending capture).
- `project_bnest_refactor_roadmap` memory updated to mark each perf bullet as shipped.
