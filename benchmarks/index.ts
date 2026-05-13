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
 * Note: each scenario boots its own Techne application. Modules are
 * intentionally isolated so a cache or singleton in one scenario can't
 * affect another. The runner is therefore I/O-light but allocation-heavy
 * — the `stabilize()` step inside each `runScenario` keeps GC out of the
 * timing window.
 */

import { isJson, renderTable, type ScenarioResult } from "./scenarios";

async function main() {
  const { runFastPathBench } = await import("./fast-path");
  const { runSlowPathBench } = await import("./slow-path");
  const { runValidationBench } = await import("./validation");
  const { runResponseSchemaBench } = await import("./response-schema");
  const { runDiBench } = await import("./di");
  const { runColdStartBench } = await import("./cold-start");

  const all: ScenarioResult[] = [];
  const sections: { title: string; results: ScenarioResult[] }[] = [];

  for (const [title, run] of [
    ["Fast path (no enhancers)", runFastPathBench],
    ["Slow path (static guard)", runSlowPathBench],
    ["Request validation", runValidationBench],
    ["Response schema (stringifier)", runResponseSchemaBench],
    ["Dependency injection", runDiBench],
    ["Cold start", runColdStartBench],
  ] as const) {
    if (!isJson()) console.error(`-> running: ${title}`);
    const results = await run();
    sections.push({ title, results });
    all.push(...results);
  }

  if (isJson()) {
    console.log(JSON.stringify({ sections }, null, 2));
    return;
  }

  // Combined matrix table (one big table is easier to copy-paste into a PR).
  console.log("\n# Techne benchmark matrix\n");
  for (const section of sections) {
    console.log(`\n## ${section.title}\n`);
    console.log(renderTable(section.results));
  }
}

await main();
