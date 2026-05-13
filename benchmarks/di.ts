/**
 * Dependency-injection resolution benchmark.
 *
 * No HTTP. Measures `container.get(TheService)` throughput in two modes:
 *  - cold: a freshly bootstrapped container, no prior calls for the token.
 *  - warm: after a warmup pass, so any memoization / static caching is hot.
 *
 * The Bnest container statically caches `isStatic(token)` and instances of
 * static providers, so the warm number should be dominated by Map lookup
 * cost. A large gap between cold and warm indicates a missed cache.
 */

import { Injectable, Module } from "../src/common";
import { TechneFactory } from "../src/core";
import { emitResults, isQuick, stabilize } from "./scenarios";
import type { ScenarioResult } from "./scenarios";

@Injectable()
class DependencyA {
  hello() {
    return "a";
  }
}

@Injectable()
class DependencyB {
  hello() {
    return "b";
  }
}

@Injectable()
class TopLevelService {
  constructor(
    public a: DependencyA,
    public b: DependencyB,
  ) {}
}

@Module({ providers: [DependencyA, DependencyB, TopLevelService] })
class DiModule {}

const app = await TechneFactory.create(DiModule, { logger: false });
const container = (app as any).container ?? (app as any).adapter?.container;

if (!container) {
  // The container is held privately; reach in via the application context.
  // TechneApplication extends TechneApplicationContext which exposes get().
  // We fall back to that.
}

/**
 * Measure `iters` lookups of `token`, returning a ScenarioResult with
 * latency stats. We use the application-level `get()` since the private
 * container reference is not part of the public API.
 */
function measureLookups(
  name: string,
  request: string,
  token: any,
  iters: number,
): ScenarioResult {
  const latencies = new Float64Array(iters);
  const lookup = (t: any) => (app as any).get(t);

  const start = Bun.nanoseconds();
  for (let i = 0; i < iters; i++) {
    const t0 = Bun.nanoseconds();
    const v = lookup(token);
    latencies[i] = (Bun.nanoseconds() - t0) / 1_000;
    if (!v) throw new Error("missing instance");
  }
  const elapsedNs = Bun.nanoseconds() - start;

  const sorted = new Float64Array(latencies);
  sorted.sort();
  let sum = 0;
  for (let i = 0; i < iters; i++) sum += sorted[i]!;
  const pct = (q: number) =>
    sorted[Math.min(iters - 1, Math.max(0, Math.floor(q * iters)))] ?? 0;

  return {
    name,
    request,
    total: iters,
    rps: iters / (elapsedNs / 1e9),
    avgUs: sum / iters,
    minUs: sorted[0] ?? 0,
    maxUs: sorted[iters - 1] ?? 0,
    p50Us: pct(0.5),
    p95Us: pct(0.95),
    p99Us: pct(0.99),
  };
}

export async function runDiBench(): Promise<ScenarioResult[]> {
  const quick = isQuick();
  // For DI we use much larger N than `getDefaults()` recommends because the
  // per-call work is tiny — a single Map lookup once everything is warm.
  const iters = quick ? 20_000 : 100_000;

  await stabilize();

  // Cold: brand new app, first call for the token. We bootstrap a fresh app
  // each time so static caches and instance map start empty.
  const coldStats: ScenarioResult[] = [];
  for (const [label, Token] of [
    ["TopLevelService (cold)", TopLevelService] as const,
    ["DependencyA (cold)", DependencyA] as const,
  ]) {
    const tmp = await TechneFactory.create(DiModule, { logger: false });
    const tmpStart = Bun.nanoseconds();
    (tmp as any).get(Token);
    const firstCallUs = (Bun.nanoseconds() - tmpStart) / 1_000;
    coldStats.push({
      name: "DI",
      request: label,
      total: 1,
      rps: 1 / (firstCallUs / 1e6),
      avgUs: firstCallUs,
      minUs: firstCallUs,
      maxUs: firstCallUs,
      p50Us: firstCallUs,
      p95Us: firstCallUs,
      p99Us: firstCallUs,
    });
    await tmp.close().catch(() => undefined);
  }

  // Warm: existing app, prime once, then time `iters` lookups.
  (app as any).get(TopLevelService);
  (app as any).get(DependencyA);
  const warmStats = [
    measureLookups("DI", "TopLevelService (warm)", TopLevelService, iters),
    measureLookups("DI", "DependencyA (warm)", DependencyA, iters),
  ];

  return [...coldStats, ...warmStats];
}

if (import.meta.main) {
  const results = await runDiBench();
  emitResults(results);
}
