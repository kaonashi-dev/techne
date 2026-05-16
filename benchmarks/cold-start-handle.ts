/**
 * In-process cold-start benchmark.
 *
 * Companion to `cold-start.ts`. That flavor spawns a fresh `bun` process per
 * run, which is the honest end-to-end number a user sees — but it also folds
 * Bun's own startup cost into the result, masking the framework's
 * contribution. This file isolates the framework boot: we call
 * `TechneFactory.create()` repeatedly *in the same process* and time only
 * that call.
 *
 * Use both numbers together:
 *  - `cold-start.ts` answers "how long until my service is ready after
 *    `bun run server.ts`?"
 *  - `cold-start-handle.ts` answers "how much of that is Techne vs. Bun?"
 *
 * Implementation:
 *  - For each N in {1, 10, 50}, synthesize a fresh app shape with N
 *    controllers and N services using the decorators API and `defineFeature`.
 *  - Run K iterations per N (20 by default, 3 with `--quick`).
 *  - Force a sync `Bun.gc(true)` between runs so GC time doesn't land inside
 *    the timing window.
 *  - Latencies recorded in microseconds via `Bun.nanoseconds()`. We report
 *    `rps = 1 / mean_seconds` so the result slots into the existing
 *    `ScenarioResult` shape.
 *
 * Standalone:
 *   bun run benchmarks/cold-start-handle.ts          # full
 *   bun run benchmarks/cold-start-handle.ts --quick  # CI smoke
 *   bun run benchmarks/cold-start-handle.ts --json   # machine-readable
 */

import { Controller, Get, Injectable } from "../src/common";
import { defineFeature, TechneFactory } from "../src/core";
import { emitResults, isQuick, type ScenarioResult } from "./scenarios";

/** Iterations per N. Tuned to keep the standalone run under ~30s at N=50. */
const ITERS_FULL = 20;
const ITERS_QUICK = 3;

interface AppShape {
  features: ReturnType<typeof defineFeature>[];
  controllers: unknown[];
  providers: unknown[];
}

/**
 * Build a fresh app shape for a given N. We can't reuse the class objects
 * across iterations: decorators install metadata on the class once, and the
 * factory consumes that metadata. To get a true "boot from scratch" timing
 * we make brand-new classes every call.
 *
 * Mirror of `_cold-start-driver.ts` so the comparison stays apples-to-apples.
 */
function buildAppShape(n: number): AppShape {
  // The "primary" service + controller that gets a real route attached.
  @Injectable()
  class PingService {
    ping() {
      return "pong";
    }
  }

  @Controller("ping")
  class PingController {
    constructor(private readonly s: PingService) {}
    @Get("/")
    ping() {
      return this.s.ping();
    }
  }

  const features: ReturnType<typeof defineFeature>[] = [];
  for (let i = 0; i < n; i++) {
    // Each iteration of the loop creates a brand-new class — by construction
    // these are unique types so the decorators do work each time, matching
    // what a real `defineFeature({ providers: [SiblingService] })` import
    // chain would do at boot.
    @Injectable()
    class SiblingService {}

    // Spread a controller per feature too, so we scale controllers and
    // services in lockstep with N. The spawn flavor only scales services;
    // adding a controller-per-feature here lets this scenario surface
    // router-explorer cost at the same rate as the scanner cost.
    @Controller(`f${i}`)
    class FeatureController {
      constructor(private readonly s: SiblingService) {}
      @Get("/")
      hit() {
        // Reference the service so it's not tree-shaken; this keeps DI
        // honest end-to-end.
        return this.s ? "ok" : "no";
      }
    }

    features.push(
      defineFeature({
        providers: [SiblingService],
        controllers: [FeatureController],
      }),
    );
  }

  return {
    features,
    controllers: [PingController],
    providers: [PingService],
  };
}

interface RunStats {
  meanUs: number;
  p50Us: number;
  p95Us: number;
  p99Us: number;
  minUs: number;
  maxUs: number;
}

function summarize(samplesUs: number[]): RunStats {
  const sorted = samplesUs.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  const pct = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    meanUs: sum / sorted.length,
    p50Us: pct(0.5),
    p95Us: pct(0.95),
    p99Us: pct(0.99),
    minUs: sorted[0] ?? 0,
    maxUs: sorted[sorted.length - 1] ?? 0,
  };
}

async function measureForN(n: number, iters: number): Promise<ScenarioResult> {
  const samplesUs: number[] = [];

  // Warm-up: do one untimed boot to get the JIT into shape for this N. This
  // matches the spirit of `runScenario`'s warmup step in `scenarios.ts` and
  // keeps the first iteration from skewing the mean.
  {
    const shape = buildAppShape(n);
    const app = await TechneFactory.create({
      features: shape.features,
      controllers: shape.controllers as never,
      providers: shape.providers as never,
      logger: false,
    });
    await app.close().catch(() => undefined);
  }

  for (let i = 0; i < iters; i++) {
    // Force a sync collection between runs so GC time doesn't land inside
    // the timing window of the next sample.
    Bun.gc(true);

    const shape = buildAppShape(n);

    const t0 = Bun.nanoseconds();
    const app = await TechneFactory.create({
      features: shape.features,
      controllers: shape.controllers as never,
      providers: shape.providers as never,
      logger: false,
    });
    const elapsedNs = Bun.nanoseconds() - t0;

    samplesUs.push(elapsedNs / 1_000);

    await app.close().catch(() => undefined);
  }

  const stats = summarize(samplesUs);
  const meanSec = stats.meanUs / 1_000_000;
  const rps = meanSec > 0 ? 1 / meanSec : 0;

  return {
    name: "Cold start (in-process)",
    request: `N=${n} (${iters} iters, mean ${(stats.meanUs / 1_000).toFixed(2)} ms)`,
    total: iters,
    rps,
    avgUs: stats.meanUs,
    minUs: stats.minUs,
    maxUs: stats.maxUs,
    p50Us: stats.p50Us,
    p95Us: stats.p95Us,
    p99Us: stats.p99Us,
  };
}

export async function runColdStartHandleBench(): Promise<ScenarioResult[]> {
  const quick = isQuick();
  const iters = quick ? ITERS_QUICK : ITERS_FULL;
  // Match the spawn flavor's N set so the two tables line up row-for-row.
  const sizes = quick ? [1, 10] : [1, 10, 50];

  const out: ScenarioResult[] = [];
  for (const n of sizes) {
    out.push(await measureForN(n, iters));
  }
  return out;
}

if (import.meta.main) {
  const results = await runColdStartHandleBench();
  emitResults(results);
}
