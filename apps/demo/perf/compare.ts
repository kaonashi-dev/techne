/**
 * Run a fresh measurement and compare its averaged metrics against the saved
 * `baseline.json`. Exits non-zero if average throughput regresses beyond the
 * threshold (default 10%), so it can gate CI.
 *
 * Usage (from the repo root):
 *   bun run apps/demo/perf/compare.ts [-n 2000] [-c 20] [--threshold 0.1]
 */
import { BASELINE_PATH, measureAll, type PerfReport, renderTable, resolveRunOptions } from "./harness";

const opts = resolveRunOptions();

const thresholdIdx = Bun.argv.indexOf("--threshold");
const threshold = thresholdIdx !== -1 ? Number(Bun.argv[thresholdIdx + 1]) : 0.1;

const baselineFile = Bun.file(BASELINE_PATH);
if (!(await baselineFile.exists())) {
  console.error(`No baseline found at ${BASELINE_PATH}. Run \`bun run perf\` first.`);
  process.exit(1);
}
const baseline = (await baselineFile.json()) as PerfReport;

console.error(`Running oha: ${opts.requests} requests @ concurrency ${opts.concurrency}\n`);
const current = await measureAll(opts);

console.log(renderTable(current));

const b = baseline.average;
const c = current.average;
const pct = (cur: number, base: number) => (base === 0 ? 0 : (cur - base) / base);

const rpsDelta = pct(c.rps, b.rps);
const p99Delta = pct(c.p99Ms, b.p99Ms);

console.log("\n## Delta vs baseline");
console.log(`baseline generated: ${baseline.generatedAt}`);
console.log(`avg req/s:  ${b.rps.toFixed(0)} → ${c.rps.toFixed(0)}  (${(rpsDelta * 100).toFixed(1)}%)`);
console.log(`avg p99 ms: ${b.p99Ms.toFixed(2)} → ${c.p99Ms.toFixed(2)}  (${(p99Delta * 100).toFixed(1)}%)`);

if (rpsDelta < -threshold) {
  console.error(
    `\n✗ Throughput regressed by ${(Math.abs(rpsDelta) * 100).toFixed(1)}% ` +
      `(threshold ${(threshold * 100).toFixed(0)}%).`,
  );
  process.exit(1);
}
console.error("\n✓ Within threshold.");
