/**
 * Shared performance-harness primitives: boot the demo server, wait for
 * readiness, mint a JWT, drive `oha` against each endpoint, parse its JSON, and
 * average every metric across endpoints.
 *
 * `oha` (https://github.com/hatoo/oha) must be installed and on PATH.
 *
 * All scripts here are launched from the repository root (see the demo's
 * package.json scripts) so the framework and its dependencies resolve.
 */
import { resolve } from "node:path";
import { API_PREFIX, endpoints, type PerfEndpoint } from "./endpoints";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const MAIN = "apps/demo/src/main.ts";

export interface EndpointMetrics {
  name: string;
  method: string;
  path: string;
  rps: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  successRate: number;
}

export interface PerfReport {
  generatedAt: string;
  oha: { requests: number; concurrency: number };
  endpoints: EndpointMetrics[];
  average: Omit<EndpointMetrics, "name" | "method" | "path">;
}

export interface RunOptions {
  port?: number;
  requests?: number;
  concurrency?: number;
}

const DEFAULTS = { port: 4599, requests: 2000, concurrency: 20 };

/** Resolve oha defaults from CLI flags / env, falling back to {@link DEFAULTS}. */
export function resolveRunOptions(argv: string[] = Bun.argv): Required<RunOptions> {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : undefined;
  };
  return {
    port: flag("--port") ?? Number(Bun.env.PERF_PORT) ?? DEFAULTS.port,
    requests: flag("-n") ?? Number(Bun.env.PERF_REQUESTS) ?? DEFAULTS.requests,
    concurrency: flag("-c") ?? Number(Bun.env.PERF_CONCURRENCY) ?? DEFAULTS.concurrency,
  };
}

export function ensureOhaInstalled(): void {
  if (Bun.which("oha")) return;
  console.error(
    "\n✗ `oha` was not found on PATH.\n\n" +
      "  Install it, then re-run:\n" +
      "    cargo install oha            # via Rust\n" +
      "    brew install oha             # macOS\n" +
      "    # or grab a release binary: https://github.com/hatoo/oha/releases\n",
  );
  process.exit(1);
}

/** Spawn the demo server from the repo root and resolve once /healthz is 200. */
export async function startServer(port: number): Promise<{ stop: () => void; origin: string }> {
  const proc = Bun.spawn(["bun", "run", MAIN], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), LOG_LEVEL: "warn" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return { stop: () => proc.kill(), origin };
    } catch {
      // server not up yet
    }
    await Bun.sleep(250);
  }
  proc.kill();
  throw new Error(`server did not become ready on ${origin} within 20s`);
}

/** Obtain an admin JWT for the guarded endpoint. */
export async function login(origin: string): Promise<string> {
  const res = await fetch(`${origin}${API_PREFIX}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
  });
  const json = (await res.json()) as { accessToken: string };
  return json.accessToken;
}

interface OhaJson {
  summary: { successRate: number; average: number; requestsPerSec: number };
  latencyPercentiles?: Record<string, number>;
}

const sec2ms = (s: number | undefined) => (s ? s * 1000 : 0);

async function runOha(
  endpoint: PerfEndpoint,
  origin: string,
  token: string | undefined,
  opts: Required<RunOptions>,
): Promise<EndpointMetrics> {
  const args = [
    "oha",
    "--no-tui",
    "--json",
    "-n",
    String(opts.requests),
    "-c",
    String(opts.concurrency),
    "-m",
    endpoint.method,
  ];
  if (endpoint.body !== undefined) {
    args.push("-T", "application/json", "-d", JSON.stringify(endpoint.body));
  }
  if (endpoint.auth && token) {
    args.push("-H", `authorization: Bearer ${token}`);
  }
  args.push(`${origin}${endpoint.path}`);

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`oha failed for ${endpoint.name} (exit ${code}): ${err || out}`);
  }

  const json = JSON.parse(out) as OhaJson;
  const pct = json.latencyPercentiles ?? {};
  return {
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    rps: json.summary.requestsPerSec,
    avgMs: sec2ms(json.summary.average),
    p50Ms: sec2ms(pct.p50),
    p90Ms: sec2ms(pct.p90),
    p95Ms: sec2ms(pct.p95),
    p99Ms: sec2ms(pct.p99),
    successRate: json.summary.successRate,
  };
}

function average(rows: EndpointMetrics[]): PerfReport["average"] {
  const n = rows.length || 1;
  const sum = (k: keyof EndpointMetrics) => rows.reduce((a, r) => a + (r[k] as number), 0);
  return {
    rps: sum("rps") / n,
    avgMs: sum("avgMs") / n,
    p50Ms: sum("p50Ms") / n,
    p90Ms: sum("p90Ms") / n,
    p95Ms: sum("p95Ms") / n,
    p99Ms: sum("p99Ms") / n,
    successRate: sum("successRate") / n,
  };
}

/** Boot the server, run oha across every endpoint, and average the metrics. */
export async function measureAll(opts: Required<RunOptions>): Promise<PerfReport> {
  ensureOhaInstalled();
  const { stop, origin } = await startServer(opts.port);
  try {
    const token = await login(origin);
    const rows: EndpointMetrics[] = [];
    for (const endpoint of endpoints) {
      console.error(`  • measuring ${endpoint.name} (${endpoint.method} ${endpoint.path}) …`);
      rows.push(await runOha(endpoint, origin, token, opts));
    }
    return {
      generatedAt: new Date().toISOString(),
      oha: { requests: opts.requests, concurrency: opts.concurrency },
      endpoints: rows,
      average: average(rows),
    };
  } finally {
    stop();
  }
}

export function renderTable(report: PerfReport): string {
  const header =
    "| Endpoint | req/s | avg ms | p50 | p95 | p99 | success |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |";
  const fmt = (n: number) => n.toFixed(n >= 100 ? 0 : 2);
  const rows = report.endpoints.map(
    (r) =>
      `| ${r.name} | ${fmt(r.rps)} | ${fmt(r.avgMs)} | ${fmt(r.p50Ms)} | ${fmt(r.p95Ms)} | ${fmt(
        r.p99Ms,
      )} | ${(r.successRate * 100).toFixed(1)}% |`,
  );
  const a = report.average;
  rows.push(
    `| **average** | ${fmt(a.rps)} | ${fmt(a.avgMs)} | ${fmt(a.p50Ms)} | ${fmt(a.p95Ms)} | ${fmt(
      a.p99Ms,
    )} | ${(a.successRate * 100).toFixed(1)}% |`,
  );
  return [header, ...rows].join("\n");
}

export const BASELINE_PATH = resolve(import.meta.dir, "baseline.json");
