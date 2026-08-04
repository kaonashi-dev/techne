# Techne benchmark matrix

A small, deterministic-as-possible suite for tracking framework performance across the code paths that actually matter.

## Scenarios

| File                 | Measures                                                                   |
| -------------------- | -------------------------------------------------------------------------- |
| `http.ts`            | Drop-in replacement for the original head-to-head: raw Elysia vs Techne.    |
| `fast-path.ts`       | Arity-specialized compiled handler (no enhancers, arity ≤ 3).              |
| `slow-path.ts`       | Cost-tagged enhancer path: static `@Injectable() CanActivate` guard.       |
| `validation.ts`      | POST with TypeBox `body` schema, valid + invalid bodies.                   |
| `response-schema.ts` | Routes with a `response` schema (exercises the fast TypeBox stringifier).  |
| `di.ts`              | Container resolution throughput, cold (1st call) vs warm (100k calls).     |
| `cold-start.ts`      | Time-to-first-request via a `Bun.spawn` child, N = 1, 10, 50 modules.      |
| `socket.ts`          | The same routes over **real loopback TCP**, through `Bun.serve`.           |
| `memory.ts`          | RSS and boot time against route count (1 → 500), one child process each.   |
| `http-client.ts`     | The **outgoing** `@kaonashi-dev/techne/http` client, against a stub fetch. |

Most HTTP scenarios use `app.handle()` in-process — no port, no socket, no kernel
scheduling noise. `socket.ts` is the deliberate exception: it exists to show how
much of the in-process gap survives once real transport cost is added. Expect its
absolute numbers to be an order of magnitude lower; the interesting figure is the
Elysia-vs-Techne *ratio*, which is much tighter there.

## How to run

```sh
bun run bench                          # full matrix (single markdown report)
bun run bench:quick                    # CI smoke; finishes in well under a minute
bun run bench:ci                       # quick, minus the port-binding and child-spawning scenarios

bun run bench:socket                   # any scenario file is also runnable standalone
bun run bench:memory
bun run bench:client

bun run benchmarks/index.ts --json     # machine-readable, for graphing / regression bots
bun run benchmarks/index.ts --skip-socket --skip-memory
```

## Comparing two runs

`bench:check` answers "did anything regress?" with an exit code. `bench:compare`
answers "what changed, and by how much?" with a table you can paste into a PR —
which is what you want when reviewing a dependency upgrade rather than a targeted
optimization.

```sh
bun run benchmarks/index.ts --json > before.json
# ...make the change...
bun run benchmarks/index.ts --json > after.json
bun run bench:compare before.json after.json --labels "Elysia 1.4,Elysia 2.0"
```

It reports per-row deltas plus a **geometric mean**, which is the right summary
for a set of ratios: it is symmetric (a 2× gain and a 2× loss cancel) and one
huge-rps row cannot dominate it the way it would an arithmetic mean.

## Methodology

- Each HTTP scenario fires **50 000** requests (5 000 in `--quick`) per measurement iteration, in **concurrent batches of 100** via `Promise.all`. The previous suite serialized every request with `await`, which understated throughput by ~10× and amplified scheduler jitter.
- **5 measured iterations** (3 in `--quick`); the highest and lowest are dropped and the remaining are averaged. Per-iteration latencies are collected into a `Float64Array` for cache-friendly percentile math.
- **Stabilization**: `Bun.gc(true)` then `await Bun.sleep(50)` before measurement so a stop-the-world GC doesn't land inside the timing window.
- **Timing**: `Bun.nanoseconds()` everywhere; reported in microseconds.
- **Cold start** uses `Bun.spawn` so process-start cost (and TypeScript transform) is honestly included.
- **Memory** spawns one child per route count. Sharing a process would let the N=1 app's retained garbage and warmed JIT code cache contaminate N=500.
- **The HTTP client scenario is sequential, not batched.** Its transport is a stub that resolves immediately, so there is no I/O to overlap and concurrency would only add promise-scheduling and GC noise on top of the thing being measured. This is not a stylistic choice: the batched version could not resolve differences below **~20 %** run-to-run, while the sequential loop holds under **2 %**.

## Sources of variance, and how the suite mitigates them

- **V8 deoptimization** — warmup runs the exact same pipeline shape so the JIT specializes on the measured shape.
- **GC pauses** — explicit `Bun.gc(true)` between warmup and measurement, plus per-iteration trimming.
- **System load** — drop-high/drop-low absorbs a single bad iteration. If two iterations are bad, re-run.
- **Microtask backlog** — `await Bun.sleep(50)` after `gc()` drains queued promise callbacks before timing starts.

### Know the noise floor before you believe a delta

Back-to-back runs of **identical code** move by **7–9 %** on the in-process
scenarios of a typical dev machine. The DI "warm" rows resolve a single `Map`
lookup, so they time tens of nanoseconds and swing with any scheduler hiccup.

Two consequences, both baked into the tooling:

- `bench:check` defaults to a **10 %** threshold. A 5 % gate fails on unchanged
  code, and a gate that cries wolf gets ignored — strictly worse than a looser
  one that means something. Pass `--threshold 0.05` on a quiet machine when
  hunting a specific regression.
- Rows measuring **fewer than 10 samples** (cold start, cold DI) are reported
  but never fail the build. They measure a single event by definition, so their
  "throughput" is one sample.

Two traps the harness now guards against, worth knowing if you extend it:

- **Never interpolate a measured value into a row label.** `bench:check` and
  `bench:compare` key rows on `name` + `request`, so a label containing the
  measurement changes every run — the row never matches its own baseline and is
  silently reported as "removed plus added", permanently outside the gate.
- **Never compare a `--quick` run against a full baseline.** Quick fires a tenth
  of the requests, so its throughput is systematically offset; the comparison
  reports fabricated double-digit regressions. The JSON output records `mode`
  and `bench:check` refuses to compare across modes.

## Interpretation

- **Raw Elysia is the absolute ceiling.** Anything Techne does costs something; a small constant overhead (a few µs of avg latency, ~10–40 % rps gap) is expected and healthy.
- The **slow-path** vs **fast-path** delta is the pure cost of the enhancer dispatcher. A static guard should hoist out at registration time, so the gap should be small.
- **Validation invalid > valid** means error construction is fast; **validation invalid ≪ valid** signals eager rich-error allocation worth investigating.
- **Response schema** with a stringifier should match or beat the plain JSON path. If it loses, the stringifier didn't fire — likely a schema-identity cache miss.
- **DI warm** should be ~one Map lookup; if it's slower than ~1 µs per call, a cache is missing.
- **Cold start** scales roughly linearly with module count today; flattening that curve is a worthwhile target.
- **Socket vs in-process** is the reality check. If the in-process gap is 2× but the on-socket gap is 1.1×, framework overhead is being amortized by transport cost and further micro-optimization buys the user nothing.
- **Memory `growth MB`** is the retention signal: the RSS delta across the load phase. A framework that leaks per-request state shows a widening gap between the two RSS columns; one that reuses buffers stays flat. `per-route KB` is computed against the smallest size so Bun's own ~55 MB floor doesn't drown out the marginal cost of a route.
- **HTTP client** numbers are pure client-side overhead per outgoing call — URL assembly, header merging, body encoding, middleware dispatch, response buffering. There is no network in the measurement.
