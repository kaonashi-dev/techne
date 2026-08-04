/**
 * Memory + route-scaling benchmark.
 *
 * The rest of the suite measures time. This one measures footprint, which is
 * the axis that decides whether a framework is viable on a 256 MB container or
 * a serverless instance — and the axis Elysia 2 targets most directly.
 *
 * Three numbers per size:
 *   - `bootMs`   — time to serve-ready (route registration + first compile)
 *   - `rss`      — resident set after boot, post-GC
 *   - `rss/load` — resident set after 20k in-process requests, post-GC
 *
 * The last one is the interesting one. A framework that allocates per-request
 * state it never releases shows a widening gap between the two RSS columns;
 * one that reuses buffers stays flat. `perRouteKb` is derived against the
 * smallest size so the fixed runtime cost (Bun itself is ~55 MB before any
 * user code) doesn't drown out the marginal cost of a route.
 *
 * Each size runs in a fresh `Bun.spawn` child — sharing a process would let
 * the N=1 app's retained garbage and warmed JIT code cache contaminate N=500.
 *
 *   bun run benchmarks/memory.ts
 *   bun run benchmarks/memory.ts --quick --json
 */

import { isJson, isQuick } from "./scenarios";

const DRIVER = new URL("./_memory-driver.ts", import.meta.url).pathname;

const SIZES_FULL = [1, 10, 50, 200, 500];
const SIZES_QUICK = [1, 25, 100];

interface MemSample {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

interface DriverOutput {
  routes: number;
  bootMs: number;
  afterBoot: MemSample;
  afterLoad: MemSample;
}

export interface MemoryResult extends DriverOutput {
  /** Marginal RSS per route, in KB, relative to the smallest measured size. */
  perRouteKb: number | null;
  /** RSS growth across the load phase, in MB — the retention signal. */
  loadGrowthMb: number;
}

async function runSize(routes: number): Promise<DriverOutput> {
  const proc = Bun.spawn(["bun", "run", DRIVER, `--routes=${routes}`, "--load"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`memory driver (routes=${routes}) exited ${exitCode}:\n${stderr}`);
  }
  // The driver prints exactly one JSON line, but Bun may emit warnings ahead
  // of it — take the last non-empty line so stray output can't break parsing.
  const line = stdout.trim().split("\n").filter(Boolean).at(-1);
  if (!line) throw new Error(`memory driver (routes=${routes}) produced no output`);
  return JSON.parse(line);
}

export async function runMemoryBench(): Promise<MemoryResult[]> {
  const sizes = isQuick() ? SIZES_QUICK : SIZES_FULL;
  const raw: DriverOutput[] = [];
  for (const n of sizes) {
    if (!isJson()) console.error(`   memory: routes=${n}`);
    raw.push(await runSize(n));
  }

  const base = raw[0];
  return raw.map((r) => ({
    ...r,
    perRouteKb:
      base && r.routes !== base.routes
        ? (r.afterBoot.rssBytes - base.afterBoot.rssBytes) / (r.routes - base.routes) / 1024
        : null,
    loadGrowthMb: (r.afterLoad.rssBytes - r.afterBoot.rssBytes) / 1024 / 1024,
  }));
}

const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export function renderMemoryTable(results: MemoryResult[]): string {
  const header =
    "| Routes | boot ms | RSS MB | RSS after load MB | growth MB | heap MB | per-route KB |\n" +
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const rows = results.map(
    (r) =>
      `| ${r.routes} | ${r.bootMs.toFixed(1)} | ${mb(r.afterBoot.rssBytes)} | ${mb(
        r.afterLoad.rssBytes,
      )} | ${r.loadGrowthMb.toFixed(1)} | ${mb(r.afterBoot.heapUsedBytes)} | ${
        r.perRouteKb === null ? "—" : r.perRouteKb.toFixed(1)
      } |`,
  );
  return [header, ...rows].join("\n");
}

if (import.meta.main) {
  const results = await runMemoryBench();
  if (isJson()) console.log(JSON.stringify(results, null, 2));
  else console.log(renderMemoryTable(results));
}
