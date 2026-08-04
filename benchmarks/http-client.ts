/**
 * Outgoing HTTP client benchmark (`@kaonashi-dev/techne/http`).
 *
 * Every other scenario in this directory measures Techne as a *server*. This
 * one measures it as a *client* — the `Http`/`PendingRequest` builder that
 * application code uses to call other services.
 *
 * The transport is deliberately stubbed. A benchmark that issued real sockets
 * would be dominated by kernel and network time and would tell you nothing
 * about the client's own per-request overhead — which is the only part Techne
 * controls. Injecting a `fetch` that returns a pre-built `Response` isolates
 * exactly the work the builder does around the call: URL assembly, header
 * merging, body encoding, middleware dispatch, and response buffering.
 *
 * Read the numbers as "microseconds of client overhead per outgoing call".
 *
 *   bun run benchmarks/http-client.ts
 *   bun run benchmarks/http-client.ts --quick --json
 */

import { Http } from "../src/http";
import {
  emitResults,
  isQuick,
  type LatencyStats,
  type ScenarioOpts,
  type ScenarioResult,
  stabilize,
} from "./scenarios";

const OPTS: ScenarioOpts = { total: 50_000, batch: 100, warmup: 2_000, iterations: 5 };
const OPTS_QUICK: ScenarioOpts = { total: 5_000, batch: 100, warmup: 200, iterations: 3 };

/**
 * Stub transport. Returns a fresh `Response` per call because the client reads
 * the body to completion — a shared instance would throw on the second read.
 */
const JSON_PAYLOAD = JSON.stringify({ id: 1, name: "Alice", email: "alice@example.com" });
const stubFetch: typeof globalThis.fetch = () =>
  Promise.resolve(
    new Response(JSON_PAYLOAD, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

interface ClientCase {
  label: string;
  run: () => Promise<unknown>;
}

/**
 * A fresh builder per call — that is how application code uses this API, and
 * the per-request allocation is part of what we are measuring.
 */
const client = () => Http.withOptions({ fetch: stubFetch }).baseUrl("http://service.internal");

function cases(): ClientCase[] {
  return [
    {
      label: "GET (bare)",
      run: () => client().get("/users"),
    },
    {
      label: "GET (query + headers)",
      run: () =>
        client().withHeader("x-tenant", "acme").acceptJson().get("/users", { page: 2, limit: 50 }),
    },
    {
      label: "POST (json body)",
      run: () =>
        client().post("/users", {
          name: "Alice",
          email: "alice@example.com",
          active: true,
        }),
    },
    {
      label: "POST (token + json)",
      run: () =>
        client()
          .withToken("secret-token")
          .post("/users", { name: "Alice", email: "alice@example.com" }),
    },
  ];
}

export async function runHttpClientBench(): Promise<ScenarioResult[]> {
  const cfg = isQuick() ? OPTS_QUICK : OPTS;
  const out: ScenarioResult[] = [];

  for (const c of cases()) {
    out.push(await measureCase(c, cfg));
  }
  return out;
}

async function measureCase(c: ClientCase, cfg: Required<ScenarioOpts>): Promise<ScenarioResult> {
  await drive(c.run, cfg.warmup, cfg.batch);
  await stabilize();

  const runs: LatencyStats[] = [];
  for (let i = 0; i < cfg.iterations; i++) {
    runs.push(await measureOnce(c.run, cfg.total, cfg.batch));
  }

  // Same drop-high/drop-low + mean the shared `runScenario` uses, so numbers
  // here are directly comparable with the server-side scenarios.
  const kept =
    runs.length > 2
      ? runs
          .slice()
          .sort((a, b) => a.rps - b.rps)
          .slice(1, -1)
      : runs;
  const n = kept.length;
  const sum = (pick: (s: LatencyStats) => number) => kept.reduce((acc, s) => acc + pick(s), 0);

  return {
    name: "Techne HTTP client",
    request: c.label,
    total: cfg.total,
    rps: sum((s) => s.rps) / n,
    avgUs: sum((s) => s.avgUs) / n,
    minUs: Math.min(...kept.map((s) => s.minUs)),
    maxUs: Math.max(...kept.map((s) => s.maxUs)),
    p50Us: sum((s) => s.p50Us) / n,
    p95Us: sum((s) => s.p95Us) / n,
    p99Us: sum((s) => s.p99Us) / n,
  };
}

/**
 * One measured pass — deliberately **sequential**.
 *
 * The server-side scenarios fire concurrent waves because a server really does
 * handle overlapping requests, and the batching reproduces that. Here the
 * transport is a stub that resolves immediately, so there is no I/O to overlap:
 * concurrency would only add promise-scheduling and GC pressure on top of the
 * thing being measured. Measured empirically, the wave-based version could not
 * resolve differences below ~20% run-to-run — larger than any optimization
 * worth making — while the sequential loop below holds well under 2%.
 */
async function measureOnce(
  run: () => Promise<unknown>,
  total: number,
  _batch: number,
): Promise<LatencyStats> {
  const latencies = new Float64Array(total);

  const startNs = Bun.nanoseconds();
  for (let i = 0; i < total; i++) {
    const t0 = Bun.nanoseconds();
    await run();
    latencies[i] = (Bun.nanoseconds() - t0) / 1_000;
  }
  const elapsedNs = Bun.nanoseconds() - startNs;

  const sorted = new Float64Array(latencies);
  sorted.sort();
  let acc = 0;
  for (let i = 0; i < total; i++) acc += sorted[i]!;
  const pct = (q: number) => sorted[Math.min(total - 1, Math.floor(q * total))] ?? 0;

  return {
    rps: total / (elapsedNs / 1e9),
    avgUs: acc / total,
    minUs: sorted[0] ?? 0,
    maxUs: sorted[total - 1] ?? 0,
    p50Us: pct(0.5),
    p95Us: pct(0.95),
    p99Us: pct(0.99),
  };
}

/** Warmup. Same sequential shape as measurement so the JIT specializes on it. */
async function drive(run: () => Promise<unknown>, total: number, _batch: number): Promise<void> {
  for (let i = 0; i < total; i++) await run();
}

if (import.meta.main) {
  emitResults(await runHttpClientBench());
}
