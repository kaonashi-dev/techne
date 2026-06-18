# Performance harness (oha)

End-to-end HTTP load test for the demo app. It boots the real server, drives
[`oha`](https://github.com/hatoo/oha) against a set of representative endpoints,
**averages every metric across endpoints**, and writes the averages to a single
file — [`baseline.json`](./baseline.json) — so future iterations can be compared
against it.

This is complementary to the framework's in-process micro-benchmarks under
`/benchmarks`: those measure `app.handle()` with no sockets; this measures a
running server over real HTTP.

## Prerequisites

`oha` must be installed and on `PATH`:

```bash
cargo install oha          # via Rust
brew install oha           # macOS
# or a release binary: https://github.com/hatoo/oha/releases
```

The runner prints install instructions and exits if `oha` is missing.

## Usage

Run from the **repository root** (the package scripts `cd ../..` for you):

```bash
# Establish / refresh the saved baseline (writes baseline.json)
bun run --cwd apps/demo perf
# or directly:
bun run apps/demo/perf/run-perf.ts

# Compare a fresh run against the saved baseline (CI gate)
bun run apps/demo/perf/compare.ts --threshold 0.1
```

Tunables (flags or env):

| Flag | Env | Default | Meaning |
| --- | --- | --- | --- |
| `-n` | `PERF_REQUESTS` | `2000` | total requests per endpoint |
| `-c` | `PERF_CONCURRENCY` | `20` | concurrent connections |
| `--port` | `PERF_PORT` | `4599` | port the demo server binds |
| `--no-save` | — | — | (`run-perf`) measure without writing `baseline.json` |
| `--threshold` | — | `0.1` | (`compare`) max tolerated avg-throughput drop |

## Endpoints measured

See [`endpoints.ts`](./endpoints.ts). Each targets a distinct code path: a static
fast GET, a parameterised GET, a validated POST (the MQ enqueue), a JWT + roles
guarded GET, and the plugin-registered `/metrics` route.

## Result file schema

`baseline.json`:

```jsonc
{
  "generatedAt": "<ISO timestamp>",
  "oha": { "requests": 2000, "concurrency": 20 },
  "endpoints": [
    { "name": "users.list", "method": "GET", "path": "/v1/api/users",
      "rps": 0, "avgMs": 0, "p50Ms": 0, "p90Ms": 0, "p95Ms": 0, "p99Ms": 0, "successRate": 1 }
  ],
  "average": { "rps": 0, "avgMs": 0, "p50Ms": 0, "p90Ms": 0, "p95Ms": 0, "p99Ms": 0, "successRate": 1 }
}
```

> `baseline.json` is generated on the first `bun run perf`. It is not committed
> with placeholder numbers — capture it on your own machine so the baseline
> reflects your hardware, then commit it to track drift across iterations.
