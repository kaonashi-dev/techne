/**
 * Top-level benchmark runner.
 *
 * Boots every scenario file in this directory in turn, collects their
 * `ScenarioResult[]`, and prints a single markdown table summarizing the
 * full matrix. Each scenario file is also runnable standalone.
 *
 *   bun run benchmarks/index.ts            # full run
 *   bun run benchmarks/index.ts --quick    # CI-smoke (~60s budget)
 *   bun run benchmarks/index.ts --json     # machine-readable for graphing
 *
 * Scenario selection:
 *   --skip-socket   omit the loopback-TCP scenario (needs to bind ports)
 *   --skip-memory   omit the footprint scenario (spawns one child per size)
 *
 * Note: each scenario boots its own Techne application. Flat configs are
 * intentionally isolated so a cache or singleton in one scenario can't
 * affect another. The runner is therefore I/O-light but allocation-heavy
 * — the `stabilize()` step inside each `runScenario` keeps GC out of the
 * timing window.
 *
 * Output shape is stable and consumed by two tools, so keep it that way:
 * `scripts/bench-check.ts` (regression gate) and `benchmarks/compare.ts`
 * (A/B report) both index on `sections[].results[]`. The `memory` block is a
 * sibling key rather than a section precisely because its rows have no `rps`.
 */

import { isJson, isQuick, renderTable, type ScenarioResult } from "./scenarios";
import { renderMemoryTable, type MemoryResult } from "./memory";

const skipSocket = process.argv.includes("--skip-socket");
const skipMemory = process.argv.includes("--skip-memory");

async function main() {
  const { runFastPathBench } = await import("./fast-path");
  const { runSlowPathBench } = await import("./slow-path");
  const { runValidationBench } = await import("./validation");
  const { runResponseSchemaBench } = await import("./response-schema");
  const { runCorsBench } = await import("./cors");
  const { runDiBench } = await import("./di");
  const { runColdStartBench } = await import("./cold-start");
  const { runColdStartHandleBench } = await import("./cold-start-handle");
  const { runHttpClientBench } = await import("./http-client");

  const sections: { title: string; results: ScenarioResult[] }[] = [];

  const scenarios: [string, () => Promise<ScenarioResult[]>][] = [
    ["Fast path (no enhancers)", runFastPathBench],
    ["Slow path (static guard)", runSlowPathBench],
    ["Request validation", runValidationBench],
    ["Response schema (stringifier)", runResponseSchemaBench],
    ["CORS", runCorsBench],
    ["Dependency injection", runDiBench],
    ["Cold start", runColdStartBench],
    ["Cold start (in-process)", runColdStartHandleBench],
    ["Outgoing HTTP client", runHttpClientBench],
  ];

  if (!skipSocket) {
    const { runSocketBench } = await import("./socket");
    scenarios.push(["Loopback TCP (real socket)", runSocketBench]);
  }

  for (const [title, run] of scenarios) {
    if (!isJson()) console.error(`-> running: ${title}`);
    sections.push({ title, results: await run() });
  }

  let memory: MemoryResult[] | undefined;
  if (!skipMemory) {
    if (!isJson()) console.error("-> running: Memory & route scaling");
    const { runMemoryBench } = await import("./memory");
    memory = await runMemoryBench();
  }

  if (isJson()) {
    // `mode` is recorded so the regression gate can refuse to compare a quick
    // run against a full baseline. The two use different request counts, so
    // their throughput numbers are systematically offset — comparing them
    // reports double-digit "regressions" that are pure methodology.
    console.log(JSON.stringify({ mode: isQuick() ? "quick" : "full", sections, memory }, null, 2));
    return;
  }

  // Combined matrix table (one big table is easier to copy-paste into a PR).
  console.log("\n# Techne benchmark matrix\n");
  for (const section of sections) {
    console.log(`\n## ${section.title}\n`);
    console.log(renderTable(section.results));
  }
  if (memory) {
    console.log(`\n## Memory & route scaling\n`);
    console.log(renderMemoryTable(memory));
  }
}

await main();
