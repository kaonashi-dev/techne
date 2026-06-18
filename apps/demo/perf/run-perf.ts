/**
 * Run the oha load test across every endpoint, average the metrics, print a
 * table, and save the averaged results to a single file (`baseline.json`) so
 * future iterations can be compared against it.
 *
 * Usage (from the repo root):
 *   bun run apps/demo/perf/run-perf.ts [-n 2000] [-c 20] [--port 4599] [--no-save]
 */
import { BASELINE_PATH, measureAll, renderTable, resolveRunOptions } from "./harness";

const opts = resolveRunOptions();
const noSave = Bun.argv.includes("--no-save");

console.error(`Running oha: ${opts.requests} requests @ concurrency ${opts.concurrency}\n`);
const report = await measureAll(opts);

console.log(renderTable(report));

if (!noSave) {
  await Bun.write(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n");
  console.error(`\n✓ Saved averaged results to ${BASELINE_PATH}`);
  console.error("  Re-run `bun run perf:compare` on future iterations to detect drift.");
}
