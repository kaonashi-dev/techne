/**
 * Child-process driver for `memory.ts`.
 *
 * Runs in its own process so the reported RSS belongs to exactly one app of
 * one size — measuring N=1 and N=500 in the same process would let the first
 * app's retained garbage and the JIT's warmed code cache pollute the second.
 *
 * Emits a single JSON line on stdout so the parent can parse it without
 * worrying about interleaved log output.
 *
 *   bun run benchmarks/_memory-driver.ts --routes=100 [--load]
 */

import { Controller, Get } from "../src/common";
import { TechneFactory } from "../src/core";

const arg = (name: string, fallback: number): number =>
  Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback);

const routeCount = arg("routes", 10);
const withLoad = process.argv.includes("--load");

/**
 * Build `routeCount` controllers, each contributing one route. Decorators are
 * applied programmatically because the count is a runtime parameter — the
 * decorator functions are the same ones the `@Controller`/`@Get` syntax calls,
 * so the registration and compilation path under measurement is identical.
 *
 * The generated controllers deliberately take no constructor dependencies.
 * TypeScript only emits `design:paramtypes` for classes that carry a decorator
 * *syntactically*, and these are decorated at runtime — so an injected
 * parameter would arrive as `undefined`. DI cost is already covered by
 * `di.ts`; what this driver isolates is per-route footprint.
 */
function buildControllers(count: number): Function[] {
  const controllers: Function[] = [];
  for (let i = 0; i < count; i++) {
    class GeneratedController {
      find() {
        return { id: i, name: "Alice", email: "alice@example.com", active: true };
      }
    }
    Object.defineProperty(GeneratedController, "name", { value: `GeneratedController${i}` });
    Get("/:id")(GeneratedController.prototype, "find", {
      value: GeneratedController.prototype.find,
    } as PropertyDescriptor);
    Controller(`res${i}`)(GeneratedController);
    controllers.push(GeneratedController);
  }
  return controllers;
}

const bootStartNs = Bun.nanoseconds();

const app = await TechneFactory.create({
  controllers: buildControllers(routeCount) as any,
  logger: false,
});

// One request forces lazy route compilation, so the boot number includes the
// full cost of becoming serve-ready rather than stopping at registration.
// It doubles as a correctness gate: a benchmark that silently measures the
// 404 or 500 path reports beautiful numbers for the wrong code.
const probe = await app.handle(new Request("http://localhost/res0/1"));
if (probe.status !== 200) {
  throw new Error(
    `memory driver probe expected 200, got ${probe.status}: ${(await probe.text()).slice(0, 200)}`,
  );
}

const bootMs = (Bun.nanoseconds() - bootStartNs) / 1_000_000;

// Settle before sampling: a boot allocates heavily and an uncollected nursery
// would be reported as steady-state footprint.
Bun.gc(true);
await Bun.sleep(50);
const afterBoot = sample();

let afterLoad = afterBoot;
if (withLoad) {
  const req = () => new Request("http://localhost/res0/1");
  for (let issued = 0; issued < 20_000; issued += 100) {
    const wave: Promise<unknown>[] = [];
    for (let i = 0; i < 100; i++) wave.push(app.handle(req()));
    await Promise.all(wave);
  }
  Bun.gc(true);
  await Bun.sleep(50);
  afterLoad = sample();
}

console.log(
  JSON.stringify({
    routes: routeCount,
    bootMs,
    afterBoot,
    afterLoad,
    // Per-route marginal cost is only meaningful against a baseline run, so
    // the parent computes it; we just report absolutes.
  }),
);

await app.close().catch(() => undefined);

function sample() {
  const mem = process.memoryUsage();
  return {
    rssBytes: mem.rss,
    heapUsedBytes: mem.heapUsed,
    heapTotalBytes: mem.heapTotal,
  };
}
