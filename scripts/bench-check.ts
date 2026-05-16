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
};

type Section = { title: string; results: Row[] };
type Matrix = { sections: Section[] };

function readJson(path: string): Matrix {
  return JSON.parse(readFileSync(path, "utf8"));
}

function key(section: string, row: Row): string {
  return `${section} :: ${row.name} :: ${row.request}`;
}

function indexRows(m: Matrix): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of m.sections) {
    for (const r of s.results) out.set(key(s.title, r), r.rps);
  }
  return out;
}

function parseArgs(argv: string[]) {
  const opts = {
    baseline: "bench/baseline.json",
    current: "",
    threshold: 0.05,
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

const baseIdx = indexRows(baseline);
const curIdx = indexRows(current);

const regressions: { key: string; baseRps: number; curRps: number; delta: number }[] = [];
const improvements: { key: string; baseRps: number; curRps: number; delta: number }[] = [];
const missing: string[] = [];
const added: string[] = [];

for (const [k, baseRps] of baseIdx) {
  const curRps = curIdx.get(k);
  if (curRps === undefined) {
    missing.push(k);
    continue;
  }
  const delta = (curRps - baseRps) / baseRps;
  if (delta < -opts.threshold) regressions.push({ key: k, baseRps, curRps, delta });
  else if (delta > opts.threshold) improvements.push({ key: k, baseRps, curRps, delta });
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
