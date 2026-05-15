/**
 * Cold-start benchmark.
 *
 * Measures the wall-clock time from `bun` process start to the point where
 * a Techne application is bootstrapped and capable of serving a request. We
 * vary the feature count (N = 1, 10, 50) so the scaling behavior of the
 * scanner and container is visible.
 *
 * Implementation:
 *  - Spawn a child Bun process via `Bun.spawn` with a tiny driver script
 *    that bootstraps `--modules N` worth of modules, runs `app.handle()`
 *    against an in-process route, and emits a single `READY <ms>` line.
 *  - We parse the timestamp from stdout. The driver script itself does the
 *    measurement so process spawn overhead is not double-counted into the
 *    framework number — but we also report the wall-clock spawn time for
 *    reference.
 *  - 3 runs per N; report avg of all 3 (no drop because N is small).
 *
 * The driver script is embedded inline so this file is self-contained.
 */

import { isQuick, emitResults, type ScenarioResult } from "./scenarios";
import { join } from "node:path";

const DRIVER_PATH = join(import.meta.dir, "_cold-start-driver.ts");

/** Driver source. Written once on first run; cached on disk to avoid `eval`. */
const DRIVER_SOURCE = `
import { Controller, Get, Injectable } from "../src/common";
import { defineFeature, TechneFactory } from "../src/core";

const t0 = Bun.nanoseconds();

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? "1");

@Injectable()
class S {
  ping() { return "pong"; }
}

@Controller("ping")
class C {
  constructor(private s: S) {}
  @Get("/")
  ping() { return this.s.ping(); }
}

const features: any[] = [];
for (let i = 0; i < N; i++) {
  @Injectable()
  class SiblingService {}

  features.push(defineFeature({ providers: [SiblingService] }));
}

const app = await TechneFactory.create({
  features,
  controllers: [C],
  providers: [S],
  logger: false,
});
// Force a handle() to ensure the first request path is JITed too.
await app.handle(new Request("http://localhost/ping"));

const ms = (Bun.nanoseconds() - t0) / 1_000_000;
console.log("READY " + ms.toFixed(3));
await app.close().catch(() => undefined);
`;

async function ensureDriver(): Promise<void> {
  await Bun.write(DRIVER_PATH, DRIVER_SOURCE);
}

interface ColdRun {
  n: number;
  internalMs: number;
  wallMs: number;
}

async function spawnOnce(n: number): Promise<ColdRun> {
  const wallStart = Bun.nanoseconds();
  const proc = Bun.spawn(["bun", "run", DRIVER_PATH, `--n=${n}`], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: join(import.meta.dir, ".."),
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  const wallMs = (Bun.nanoseconds() - wallStart) / 1_000_000;

  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`cold-start driver failed (n=${n}, exit=${code}): ${stderr}`);
  }

  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("READY "));
  if (!line) throw new Error(`no READY line in output: ${stdout}`);
  const internalMs = Number(line.slice("READY ".length));
  return { n, internalMs, wallMs };
}

function aggregate(name: string, runs: ColdRun[]): ScenarioResult {
  const internals = runs.map((r) => r.internalMs).sort((a, b) => a - b);
  const walls = runs.map((r) => r.wallMs).sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const pct = (xs: number[], q: number) =>
    xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;

  // We report milliseconds as "µs" columns scaled — the table headers are
  // microseconds, but for cold-start that's not a useful unit. Instead we
  // convert ms→µs on the way out so the table prints in microseconds
  // throughout (a 100ms boot becomes 100000 µs). The runner prints a note.
  return {
    name: "Cold start",
    request: `${name} bootstrap (avg ms = ${mean(internals).toFixed(1)}, wall ${mean(walls).toFixed(1)})`,
    total: runs.length,
    rps: 1_000 / mean(internals),
    avgUs: mean(internals) * 1_000,
    minUs: internals[0]! * 1_000,
    maxUs: internals[internals.length - 1]! * 1_000,
    p50Us: pct(internals, 0.5) * 1_000,
    p95Us: pct(internals, 0.95) * 1_000,
    p99Us: pct(internals, 0.99) * 1_000,
  };
}

export async function runColdStartBench(): Promise<ScenarioResult[]> {
  await ensureDriver();
  const quick = isQuick();
  const runsPerN = quick ? 2 : 3;
  const sizes = quick ? [1, 10] : [1, 10, 50];

  const out: ScenarioResult[] = [];
  for (const n of sizes) {
    const runs: ColdRun[] = [];
    for (let i = 0; i < runsPerN; i++) {
      runs.push(await spawnOnce(n));
    }
    out.push(aggregate(`N=${n}`, runs));
  }
  return out;
}

if (import.meta.main) {
  const results = await runColdStartBench();
  emitResults(results);
}
