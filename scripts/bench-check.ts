#!/usr/bin/env bun
/**
 * Regression gate for the bench matrix.
 *
 *   bun run scripts/bench-check.ts [--baseline path] [--threshold 0.05] [--quick]
 *
 * Runs the matrix (or reads --current path), then compares against
 * bench/baseline.json. Fails (exit 1) when any matched row's rps drops by
 * more than `threshold` (default 5%). New or missing rows are warnings,
 * not failures.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Row = {
  name: string;
  request: string;
  rps: number;
  /** Requests per measured iteration. Single-sample rows are excluded from the gate. */
  total?: number;
};

type Section = { title: string; results: Row[] };
type Matrix = { mode?: "quick" | "full"; sections: Section[] };

/**
 * Rows below this many requests per iteration are reported but never fail the
 * build. The cold-start and cold-DI scenarios measure a single event by
 * definition, so their "throughput" is one sample — a scheduler hiccup swings
 * it by an order of magnitude and would redline the gate on every run.
 */
const MIN_SAMPLES_TO_GATE = 10;

function readJson(path: string): Matrix {
  return JSON.parse(readFileSync(path, "utf8"));
}

function key(section: string, row: Row): string {
  return `${section} :: ${row.name} :: ${row.request}`;
}

function indexRows(m: Matrix): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const s of m.sections) {
    for (const r of s.results) out.set(key(s.title, r), r);
  }
  return out;
}

function parseArgs(argv: string[]) {
  const opts = {
    baseline: "bench/baseline.json",
    current: "",
    // 10 %, not 5 %. Back-to-back runs of *identical* code on this suite move
    // by 7-9 % on the in-process scenarios — the DI "warm" rows resolve a
    // single Map lookup, so they are timing tens of nanoseconds and swing with
    // any scheduler noise. A 5 % gate therefore fails on unchanged code, and a
    // gate that cries wolf gets ignored or disabled, which is strictly worse
    // than a looser one that means something. Pass `--threshold 0.05` on a
    // quiet machine when hunting a specific regression.
    threshold: 0.1,
    quick: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") opts.baseline = argv[++i]!;
    else if (a === "--current") opts.current = argv[++i]!;
    else if (a === "--threshold") opts.threshold = Number(argv[++i]);
    else if (a === "--quick") opts.quick = true;
  }
  return opts;
}

function captureCurrent(quick: boolean): Matrix {
  const args = ["run", "benchmarks/index.ts", "--json"];
  if (quick) args.push("--quick");
  const r = spawnSync("bun", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error(r.stderr);
    throw new Error(`bench run failed (exit ${r.status})`);
  }
  return JSON.parse(r.stdout);
}

const opts = parseArgs(process.argv);
const baselinePath = resolve(opts.baseline);
if (!existsSync(baselinePath)) {
  console.error(
    `baseline not found at ${baselinePath} — skipping regression gate (exit 0).\n` +
      `Capture one on this machine with:\n  bun run bench > ${opts.baseline}.tmp && mv ${opts.baseline}.tmp ${opts.baseline}`,
  );
  process.exit(0);
}

const baseline = readJson(baselinePath);
const current = opts.current ? readJson(resolve(opts.current)) : captureCurrent(opts.quick);

// A quick run fires a tenth of the requests a full run does, so its throughput
// is systematically lower. Comparing across modes reports fabricated
// double-digit regressions, which is worse than not checking at all.
if (baseline.mode && current.mode && baseline.mode !== current.mode) {
  console.error(
    `bench mode mismatch: baseline is "${baseline.mode}", current is "${current.mode}".\n` +
      `These are not comparable — a quick run uses far fewer requests per iteration.\n` +
      `Re-capture the baseline in the same mode:\n` +
      `  bun run benchmarks/index.ts --json${current.mode === "quick" ? " --quick" : ""} > ${opts.baseline}`,
  );
  process.exit(2);
}

const baseIdx = indexRows(baseline);
const curIdx = indexRows(current);

type Delta = { key: string; baseRps: number; curRps: number; delta: number };
const regressions: Delta[] = [];
const improvements: Delta[] = [];
/** Regressed, but on too few samples to be trustworthy — reported, not fatal. */
const noisyRegressions: Delta[] = [];
const missing: string[] = [];
const added: string[] = [];

for (const [k, baseRow] of baseIdx) {
  const curRow = curIdx.get(k);
  if (curRow === undefined) {
    missing.push(k);
    continue;
  }
  const baseRps = baseRow.rps;
  const curRps = curRow.rps;
  const delta = (curRps - baseRps) / baseRps;
  const entry = { key: k, baseRps, curRps, delta };
  const samples = Math.min(baseRow.total ?? Infinity, curRow.total ?? Infinity);
  if (delta < -opts.threshold) {
    (samples < MIN_SAMPLES_TO_GATE ? noisyRegressions : regressions).push(entry);
  } else if (delta > opts.threshold) {
    improvements.push(entry);
  }
}
for (const k of curIdx.keys()) if (!baseIdx.has(k)) added.push(k);

const fmt = (n: number) => Math.round(n).toLocaleString();
const pct = (d: number) => `${(d * 100).toFixed(1)}%`;

console.log(`# Bench check (threshold ${pct(opts.threshold)})\n`);
console.log(`baseline: ${baselinePath}`);
console.log(
  `rows: ${baseIdx.size} baseline / ${curIdx.size} current — ${regressions.length} regressions, ${improvements.length} improvements\n`,
);

if (regressions.length > 0) {
  console.log("## Regressions");
  for (const r of regressions) {
    console.log(`- ${r.key}: ${fmt(r.baseRps)} → ${fmt(r.curRps)} rps (${pct(r.delta)})`);
  }
  console.log();
}
if (noisyRegressions.length > 0) {
  console.log(`## Regressed but not gated (fewer than ${MIN_SAMPLES_TO_GATE} samples)`);
  for (const r of noisyRegressions) {
    console.log(`- ${r.key}: ${fmt(r.baseRps)} → ${fmt(r.curRps)} rps (${pct(r.delta)})`);
  }
  console.log();
}
if (improvements.length > 0) {
  console.log("## Improvements");
  for (const r of improvements) {
    console.log(`- ${r.key}: ${fmt(r.baseRps)} → ${fmt(r.curRps)} rps (+${pct(r.delta)})`);
  }
  console.log();
}
if (missing.length > 0) {
  console.log("## Missing rows (baseline only)");
  for (const k of missing) console.log(`- ${k}`);
  console.log();
}
if (added.length > 0) {
  console.log("## New rows (current only)");
  for (const k of added) console.log(`- ${k}`);
  console.log();
}

process.exit(regressions.length > 0 ? 1 : 0);
