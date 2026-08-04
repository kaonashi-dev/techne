#!/usr/bin/env bun
/**
 * Side-by-side comparison of two benchmark matrices.
 *
 * `scripts/bench-check.ts` answers "did anything regress?" with an exit code.
 * This answers "what changed, and by how much?" with a table you can paste into
 * a PR — which is what you want when the change under review is a dependency
 * upgrade rather than a targeted optimization.
 *
 *   bun run benchmarks/index.ts --json > /tmp/before.json
 *   # ...make the change...
 *   bun run benchmarks/index.ts --json > /tmp/after.json
 *   bun run benchmarks/compare.ts /tmp/before.json /tmp/after.json
 *
 * Flags:
 *   --labels "Elysia 1.4,Elysia 2.0"   column headers (default: file basenames)
 *   --threshold 0.05                   below this, a delta renders as "≈"
 *   --json                             machine-readable output
 *
 * Deltas are on throughput, where higher is better, so a positive percentage
 * always means "faster" regardless of which column moved.
 */

import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

interface Row {
  name: string;
  request: string;
  rps: number;
  avgUs: number;
  p99Us: number;
}
interface Section {
  title: string;
  results: Row[];
}
interface Matrix {
  sections: Section[];
}

interface ComparedRow {
  section: string;
  name: string;
  request: string;
  before: Row | null;
  after: Row | null;
  /** Fractional change in rps; null when the row exists on only one side. */
  delta: number | null;
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const opts = { labels: [] as string[], threshold: 0.05, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--labels") opts.labels = (argv[++i] ?? "").split(",").map((s) => s.trim());
    else if (a === "--threshold") opts.threshold = Number(argv[++i]);
    else if (a === "--json") opts.json = true;
    else positional.push(a);
  }
  return { opts, positional };
}

const { opts, positional } = parseArgs(process.argv);
const [beforePath, afterPath] = positional;

if (!beforePath || !afterPath) {
  console.error(
    "usage: bun run benchmarks/compare.ts <before.json> <after.json> " +
      '[--labels "A,B"] [--threshold 0.05] [--json]',
  );
  process.exit(2);
}
for (const p of [beforePath, afterPath]) {
  if (!existsSync(p)) {
    console.error(`not found: ${p}`);
    process.exit(2);
  }
}

const before: Matrix = JSON.parse(readFileSync(beforePath, "utf8"));
const after: Matrix = JSON.parse(readFileSync(afterPath, "utf8"));
const [labelA, labelB] = [
  opts.labels[0] ?? basename(beforePath, ".json"),
  opts.labels[1] ?? basename(afterPath, ".json"),
];

const rowKey = (section: string, r: Row) => `${section} ${r.name} ${r.request}`;

function index(m: Matrix): Map<string, { section: string; row: Row }> {
  const out = new Map<string, { section: string; row: Row }>();
  for (const s of m.sections ?? []) {
    for (const r of s.results ?? []) out.set(rowKey(s.title, r), { section: s.title, row: r });
  }
  return out;
}

const beforeIdx = index(before);
const afterIdx = index(after);

// Preserve the "after" ordering — it is the current shape of the suite — then
// append rows that only the baseline had, so disappearing rows stay visible
// instead of being silently dropped from the report.
const keys = [...afterIdx.keys(), ...[...beforeIdx.keys()].filter((k) => !afterIdx.has(k))];

const compared: ComparedRow[] = keys.map((k) => {
  const b = beforeIdx.get(k);
  const a = afterIdx.get(k);
  const meta = a ?? b!;
  const delta = b && a && b.row.rps > 0 ? (a.row.rps - b.row.rps) / b.row.rps : null;
  return {
    section: meta.section,
    name: meta.row.name,
    request: meta.row.request,
    before: b?.row ?? null,
    after: a?.row ?? null,
    delta,
  };
});

if (opts.json) {
  console.log(JSON.stringify({ labelA, labelB, rows: compared }, null, 2));
  process.exit(0);
}

const fmtRps = (n: number | undefined) => (n === undefined ? "—" : Math.round(n).toLocaleString());
const fmtUs = (n: number | undefined) =>
  n === undefined ? "—" : n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toString();

function fmtDelta(d: number | null): string {
  if (d === null) return "—";
  if (Math.abs(d) < opts.threshold) return "≈";
  const pct = `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
  return d > 0 ? `**${pct}**` : pct;
}

console.log(`# Benchmark comparison: ${labelA} → ${labelB}\n`);
console.log(`- baseline: \`${beforePath}\``);
console.log(`- current:  \`${afterPath}\``);
console.log(`- deltas below ${(opts.threshold * 100).toFixed(0)}% shown as \`≈\` (noise floor)\n`);

const bySection = new Map<string, ComparedRow[]>();
for (const r of compared) {
  const list = bySection.get(r.section);
  if (list) list.push(r);
  else bySection.set(r.section, [r]);
}

for (const [title, rows] of bySection) {
  console.log(`\n## ${title}\n`);
  console.log(
    `| Scenario | Request | ${labelA} req/s | ${labelB} req/s | Δ rps | ` +
      `${labelA} p99 µs | ${labelB} p99 µs |`,
  );
  console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: |");
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${r.request} | ${fmtRps(r.before?.rps)} | ${fmtRps(r.after?.rps)} | ` +
        `${fmtDelta(r.delta)} | ${fmtUs(r.before?.p99Us)} | ${fmtUs(r.after?.p99Us)} |`,
    );
  }
}

// Geometric mean is the right summary for a set of ratios: it is symmetric
// (a 2x gain and a 2x loss cancel) and immune to one huge-rps row dominating
// the average the way an arithmetic mean would.
const ratios = compared.filter((r) => r.delta !== null).map((r) => 1 + r.delta!);
if (ratios.length > 0) {
  const geo = Math.exp(ratios.reduce((s, x) => s + Math.log(x), 0) / ratios.length) - 1;
  const regressions = compared.filter((r) => r.delta !== null && r.delta < -opts.threshold);
  const improvements = compared.filter((r) => r.delta !== null && r.delta > opts.threshold);
  console.log(`\n## Summary\n`);
  console.log(`- matched rows: ${ratios.length}`);
  console.log(`- geometric mean throughput change: ${(geo * 100).toFixed(1)}%`);
  console.log(`- improvements: ${improvements.length}, regressions: ${regressions.length}`);
  if (regressions.length > 0) {
    console.log(`\nRegressions worth a look:\n`);
    for (const r of regressions.sort((a, b) => a.delta! - b.delta!).slice(0, 10)) {
      console.log(
        `- \`${r.section} :: ${r.name} :: ${r.request}\` ${fmtRps(r.before?.rps)} → ` +
          `${fmtRps(r.after?.rps)} (${(r.delta! * 100).toFixed(1)}%)`,
      );
    }
  }
}
