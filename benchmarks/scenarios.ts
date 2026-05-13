/**
 * Shared benchmark helpers.
 *
 * Provides a single `runScenario()` that exercises a handler with concurrent
 * batches and collects per-request latencies into a `Float64Array` for tight
 * cache-friendly percentile math. Designed to be called by every scenario
 * file in this directory so results are directly comparable.
 *
 * Stabilization (gc + microtask drain) is performed before the measured
 * iterations. Each measurement run produces a `ScenarioResult` containing
 * throughput and a latency distribution; multiple runs are aggregated by
 * the caller (drop-high/drop-low + mean).
 */

export interface ScenarioRequest {
  /** Stable label printed in the markdown table. */
  label: string;
  /**
   * Per-call request factory. Returning a single shared `Request` object is
   * fine since `app.handle()` clones what it needs; however, some adapters
   * may mutate streams, so cheap recreation keeps the benchmark honest.
   */
  make: () => Request;
}

export interface ScenarioOpts {
  /** Total number of requests fired per measurement iteration. */
  total?: number;
  /** Concurrent batch size (Promise.all width). */
  batch?: number;
  /** Warmup requests run before the first measurement iteration. */
  warmup?: number;
  /** Number of measurement iterations. After dropping high/low, the remaining are averaged. */
  iterations?: number;
}

export interface LatencyStats {
  /** Throughput in requests per second (averaged across kept iterations). */
  rps: number;
  /** Mean per-request latency in microseconds (averaged across kept iterations). */
  avgUs: number;
  /** Best per-request latency observed across kept iterations. */
  minUs: number;
  /** Worst per-request latency observed across kept iterations. */
  maxUs: number;
  /** Median latency (us). */
  p50Us: number;
  /** 95th percentile latency (us). */
  p95Us: number;
  /** 99th percentile latency (us). */
  p99Us: number;
}

export interface ScenarioResult extends LatencyStats {
  /** Scenario label, used as the first column of the printed table. */
  name: string;
  /** Request label (sub-scenario, e.g. "GET /users vs GET /users/:id"). */
  request: string;
  /** Total requests issued per measurement iteration. */
  total: number;
}

const DEFAULTS_FULL: Required<ScenarioOpts> = {
  total: 50_000,
  batch: 100,
  warmup: 2_000,
  iterations: 5,
};

const DEFAULTS_QUICK: Required<ScenarioOpts> = {
  total: 5_000,
  batch: 100,
  warmup: 200,
  iterations: 3,
};

/** Picks default knobs based on the CLI flag set on the process. */
export function getDefaults(quick = isQuick()): Required<ScenarioOpts> {
  return quick ? { ...DEFAULTS_QUICK } : { ...DEFAULTS_FULL };
}

export function isQuick(argv: string[] = process.argv): boolean {
  return argv.includes("--quick");
}

export function isJson(argv: string[] = process.argv): boolean {
  return argv.includes("--json");
}

/**
 * Run one HTTP scenario through a Bnest or raw-Elysia adapter.
 *
 * `handler` must be the underlying `(req) => Promise<Response>` callable —
 * for Bnest use `app.handle.bind(app)` and for Elysia use
 * `elysiaApp.handle.bind(elysiaApp)`. We avoid passing the app itself so the
 * benchmark stays type-agnostic.
 */
export async function runScenario(
  name: string,
  handler: (req: Request) => Promise<Response>,
  request: ScenarioRequest,
  opts: ScenarioOpts = {},
): Promise<ScenarioResult> {
  const cfg = { ...getDefaults(), ...opts };

  // Warmup. Don't time. Use the same concurrent shape as measurement so the
  // JIT specializes on the actual call pattern.
  await runBatched(handler, request.make, cfg.warmup, cfg.batch);

  await stabilize();

  const perIteration: LatencyStats[] = [];
  for (let i = 0; i < cfg.iterations; i++) {
    perIteration.push(await measureOnce(handler, request.make, cfg.total, cfg.batch));
  }

  const kept = trimHighLow(perIteration);
  const aggregated = average(kept);

  return {
    name,
    request: request.label,
    total: cfg.total,
    ...aggregated,
  };
}

/**
 * One measured pass. Splits `total` into `batch`-sized concurrent waves
 * via `Promise.all` to actually exercise the request pipeline as a server
 * would (the previous benchmark serialized every call with `await`).
 */
async function measureOnce(
  handler: (req: Request) => Promise<Response>,
  make: () => Request,
  total: number,
  batch: number,
): Promise<LatencyStats> {
  const latencies = new Float64Array(total);
  let idx = 0;

  const startNs = Bun.nanoseconds();
  for (let issued = 0; issued < total; issued += batch) {
    const n = Math.min(batch, total - issued);
    const promises = new Array<Promise<unknown>>(n);
    for (let i = 0; i < n; i++) {
      const t0 = Bun.nanoseconds();
      const localIdx = idx++;
      promises[i] = handler(make()).then((res) => {
        latencies[localIdx] = (Bun.nanoseconds() - t0) / 1_000;
        // touch the response so the optimizer can't drop it.
        return res.status;
      });
    }
    await Promise.all(promises);
  }
  const elapsedNs = Bun.nanoseconds() - startNs;

  return summarize(latencies, elapsedNs);
}

/** Like `measureOnce` but discards latencies — used for warmup. */
async function runBatched(
  handler: (req: Request) => Promise<Response>,
  make: () => Request,
  total: number,
  batch: number,
): Promise<void> {
  for (let issued = 0; issued < total; issued += batch) {
    const n = Math.min(batch, total - issued);
    const promises = new Array<Promise<unknown>>(n);
    for (let i = 0; i < n; i++) {
      promises[i] = handler(make()).then((res) => res.status);
    }
    await Promise.all(promises);
  }
}

/**
 * Pre-measurement stabilization. Forces a sync GC so a stop-the-world
 * collection doesn't land inside the measurement window, then yields once
 * to drain queued microtasks.
 */
export async function stabilize(): Promise<void> {
  Bun.gc(true);
  await Bun.sleep(50);
}

/** Drop the highest and lowest iterations. Keeps the middle for averaging. */
function trimHighLow(samples: LatencyStats[]): LatencyStats[] {
  if (samples.length <= 2) return samples.slice();
  const sorted = samples.slice().sort((a, b) => a.rps - b.rps);
  return sorted.slice(1, -1);
}

function average(samples: LatencyStats[]): LatencyStats {
  if (samples.length === 0) {
    return { rps: 0, avgUs: 0, minUs: 0, maxUs: 0, p50Us: 0, p95Us: 0, p99Us: 0 };
  }
  const acc: LatencyStats = {
    rps: 0,
    avgUs: 0,
    minUs: Infinity,
    maxUs: 0,
    p50Us: 0,
    p95Us: 0,
    p99Us: 0,
  };
  for (const s of samples) {
    acc.rps += s.rps;
    acc.avgUs += s.avgUs;
    acc.minUs = Math.min(acc.minUs, s.minUs);
    acc.maxUs = Math.max(acc.maxUs, s.maxUs);
    acc.p50Us += s.p50Us;
    acc.p95Us += s.p95Us;
    acc.p99Us += s.p99Us;
  }
  const n = samples.length;
  return {
    rps: acc.rps / n,
    avgUs: acc.avgUs / n,
    minUs: acc.minUs,
    maxUs: acc.maxUs,
    p50Us: acc.p50Us / n,
    p95Us: acc.p95Us / n,
    p99Us: acc.p99Us / n,
  };
}

function summarize(latencies: Float64Array, elapsedNs: number): LatencyStats {
  const total = latencies.length;
  // Sort a copy for percentile math; Float64Array sort is in-place but here
  // we want the originally collected order to stay readable if a caller
  // wants to log it. Allocation is one Float64Array per iteration — cheap.
  const sorted = new Float64Array(latencies);
  sorted.sort();

  let sum = 0;
  for (let i = 0; i < total; i++) sum += sorted[i]!;

  const elapsedSec = elapsedNs / 1e9;
  return {
    rps: total / elapsedSec,
    avgUs: sum / total,
    minUs: sorted[0] ?? 0,
    maxUs: sorted[total - 1] ?? 0,
    p50Us: percentile(sorted, 0.5),
    p95Us: percentile(sorted, 0.95),
    p99Us: percentile(sorted, 0.99),
  };
}

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

export function formatRps(rps: number): string {
  return Math.round(rps).toLocaleString();
}

export function formatUs(us: number): string {
  if (us < 10) return us.toFixed(2);
  if (us < 100) return us.toFixed(1);
  return Math.round(us).toString();
}

/** Render a list of results as a single markdown table. */
export function renderTable(results: ScenarioResult[]): string {
  const header =
    "| Scenario | Request | req/s | avg µs | p50 µs | p95 µs | p99 µs |\n" +
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |";
  const rows = results.map(
    (r) =>
      `| ${r.name} | ${r.request} | ${formatRps(r.rps)} | ${formatUs(r.avgUs)} | ${formatUs(
        r.p50Us,
      )} | ${formatUs(r.p95Us)} | ${formatUs(r.p99Us)} |`,
  );
  return [header, ...rows].join("\n");
}

/** Emit results as either markdown or JSON, depending on the `--json` flag. */
export function emitResults(results: ScenarioResult[]): void {
  if (isJson()) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(renderTable(results));
  }
}
