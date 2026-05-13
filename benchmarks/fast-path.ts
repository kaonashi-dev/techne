/**
 * Fast-path benchmark.
 *
 * Targets the arity-specialized compiled handler in
 * `src/core/router/router-execution-context.ts`: routes with no enhancers
 * (no guard / pipe / interceptor / filter / request-scoped dep) and
 * handler arity ≤3. These are the routes that should sit closest to raw
 * Elysia throughput.
 *
 * Pairs the same two endpoints under both Raw Elysia and Techne so the
 * overhead column in the table is meaningful.
 */

import { Elysia } from "elysia";
import { Controller, Get, Injectable, Module, Param } from "../src/common";
import { TechneFactory } from "../src/core";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

@Injectable()
class FastService {
  getAll() {
    return [{ id: 1, name: "Alice" }];
  }
  getOne(id: string) {
    return { id, name: "Alice" };
  }
}

@Controller("users")
class FastController {
  constructor(private svc: FastService) {}

  @Get("/")
  findAll() {
    return this.svc.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.svc.getOne(id);
  }
}

@Module({ controllers: [FastController], providers: [FastService] })
class FastModule {}

const elysiaApp = new Elysia()
  .get("/users", () => [{ id: 1, name: "Alice" }])
  .get("/users/:id", ({ params }) => ({ id: params.id, name: "Alice" }));

const bnestApp = await TechneFactory.create(FastModule, { logger: false });

export async function runFastPathBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  const requests = [
    { label: "GET /users", make: () => new Request("http://localhost/users") },
    { label: "GET /users/:id", make: () => new Request("http://localhost/users/42") },
  ];

  const out: ScenarioResult[] = [];
  for (const req of requests) {
    out.push(await runScenario("Elysia (fast)", (r) => elysiaApp.handle(r), req, opts));
  }
  for (const req of requests) {
    out.push(await runScenario("Techne (fast)", (r) => bnestApp.handle(r), req, opts));
  }
  return out;
}

if (import.meta.main) {
  const results = await runFastPathBench();
  emitResults(results);
}
