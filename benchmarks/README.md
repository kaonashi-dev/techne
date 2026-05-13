# Bnest benchmark matrix

A small, deterministic-as-possible suite for tracking framework performance across the code paths that actually matter.

## Scenarios

| File                  | Measures                                                                     |
| --------------------- | ---------------------------------------------------------------------------- |
| `http.ts`             | Drop-in replacement for the original head-to-head: raw Elysia vs Bnest.      |
| `fast-path.ts`        | Arity-specialized compiled handler (no enhancers, arity ≤ 3).                |
| `slow-path.ts`        | Cost-tagged enhancer path: static `@Injectable() CanActivate` guard.         |
| `validation.ts`       | POST with TypeBox `body` schema, valid + invalid bodies.                     |
| `response-schema.ts`  | Routes with a `response` schema (exercises the fast TypeBox stringifier).    |
| `di.ts`               | Container resolution throughput, cold (1st call) vs warm (100k calls).      |
| `cold-start.ts`       | Time-to-first-request via a `Bun.spawn` child, N = 1, 10, 50 modules.        |

Every HTTP scenario uses `app.handle()` in-process — no port, no socket, no kernel scheduling noise.

## How to run

```sh
bun run benchmarks/index.ts            # full matrix (single markdown report)
bun run benchmarks/index.ts --quick    # CI smoke; finishes in well under a minute
bun run benchmarks/index.ts --json     # machine-readable, for graphing / regression bots

bun run benchmarks/http.ts             # any scenario file is also runnable standalone
bun run benchmarks/http.ts --quick --json
```

## Methodology

- Each HTTP scenario fires **50 000** requests (5 000 in `--quick`) per measurement iteration, in **concurrent batches of 100** via `Promise.all`. The previous suite serialized every request with `await`, which understated throughput by ~10× and amplified scheduler jitter.
- **5 measured iterations** (3 in `--quick`); the highest and lowest are dropped and the remaining are averaged. Per-iteration latencies are collected into a `Float64Array` for cache-friendly percentile math.
- **Stabilization**: `Bun.gc(true)` then `await Bun.sleep(50)` before measurement so a stop-the-world GC doesn't land inside the timing window.
- **Timing**: `Bun.nanoseconds()` everywhere; reported in microseconds.
- **Cold start** uses `Bun.spawn` so process-start cost (and TypeScript transform) is honestly included.

## Sources of variance, and how the suite mitigates them

- **V8 deoptimization** — warmup runs the exact same batched pipeline so the JIT specializes on the measured shape.
- **GC pauses** — explicit `Bun.gc(true)` between warmup and measurement, plus per-iteration trimming.
- **System load** — drop-high/drop-low absorbs a single bad iteration. If two iterations are bad, re-run.
- **Microtask backlog** — `await Bun.sleep(50)` after `gc()` drains queued promise callbacks before timing starts.

## Interpretation

- **Raw Elysia is the absolute ceiling.** Anything Bnest does costs something; a small constant overhead (a few µs of avg latency, ~10–40 % rps gap) is expected and healthy.
- The **slow-path** vs **fast-path** delta is the pure cost of the enhancer dispatcher. A static guard should hoist out at registration time, so the gap should be small.
- **Validation invalid > valid** means error construction is fast; **validation invalid ≪ valid** signals eager rich-error allocation worth investigating.
- **Response schema** with a stringifier should match or beat the plain JSON path. If it loses, the stringifier didn't fire — likely a schema-identity cache miss.
- **DI warm** should be ~one Map lookup; if it's slower than ~1 µs per call, a cache is missing.
- **Cold start** scales roughly linearly with module count today; flattening that curve is a worthwhile target.
