/**
 * HTTP Benchmark — Raw Elysia vs Techne.
 *
 * Methodology fixes vs the original:
 *  - Concurrent batches of 100 issued via `Promise.all` instead of an awaited
 *    serial loop, so the request pipeline is actually exercised the way a
 *    real server would dispatch overlapping work.
 *  - 5 measured iterations; highest and lowest are dropped, the remaining 3
 *    are averaged. Reports min/avg/max + p50/p95/p99.
 *  - `Bun.nanoseconds()` for timing.
 *  - Pre-measurement stabilization: `Bun.gc(true)` + `Bun.sleep(50)` to
 *    drain microtasks so a stop-the-world collection doesn't land inside
 *    the timing window.
 *
 * Run:
 *   bun run benchmarks/http.ts
 *   bun run benchmarks/http.ts --quick
 *   bun run benchmarks/http.ts --json
 */

import { Elysia } from "elysia";
import { Controller, Get, Injectable, Param } from "../src/common";
import { TechneFactory } from "../src/core";
import {
  emitResults,
  getDefaults,
  isJson,
  isQuick,
  runScenario,
  type ScenarioResult,
} from "./scenarios";

// ─── Raw Elysia (the ceiling) ───────────────────────────────────────────────

const elysiaApp = new Elysia()
  .get("/users", () => [{ id: 1, name: "Alice" }])
  .get("/users/:id", ({ params }) => ({ id: params.id, name: "Alice" }));

// ─── Techne (the framework under test) ──────────────────────────────────────

@Injectable()
class UserService {
  getAll() {
    return [{ id: 1, name: "Alice" }];
  }
  getOne(id: string) {
    return { id, name: "Alice" };
  }
}

@Controller("users")
class UserController {
  constructor(private userService: UserService) {}

  @Get("/")
  findAll() {
    return this.userService.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.userService.getOne(id);
  }
}

const techneApp = await TechneFactory.create({
  controllers: [UserController],
  providers: [UserService],
  logger: false,
});

// ─── Run ───────────────────────────────────────────────────────────────────

export async function runHttpBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  const requests = [
    { label: "GET /users", make: () => new Request("http://localhost/users") },
    { label: "GET /users/:id", make: () => new Request("http://localhost/users/42") },
  ];

  const results: ScenarioResult[] = [];
  for (const req of requests) {
    results.push(await runScenario("Raw Elysia", (r) => elysiaApp.handle(r), req, opts));
  }
  for (const req of requests) {
    results.push(await runScenario("Techne", (r) => techneApp.handle(r), req, opts));
  }
  return results;
}

if (import.meta.main) {
  const results = await runHttpBench();
  if (!isJson()) {
    console.log(
      `\nHTTP fast-path: ${results[0]?.total.toLocaleString()} req per iter, drop-high/drop-low across iterations.\n`,
    );
  }
  emitResults(results);
}
