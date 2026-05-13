/**
 * Slow-path benchmark.
 *
 * Exercises the cost-tagged enhancer execution path: routes with at least
 * one guard, pipe, interceptor, or filter (or a request-scoped dep) bypass
 * the arity-specialized fast path. The guard here is the cheapest possible
 * one — a static `@Injectable()` `CanActivate` that always allows — so the
 * delta between this scenario and `fast-path` is the pure cost of the
 * enhancer dispatch machinery (plus any hoisting wins from Batch 1's
 * static-guard optimization).
 */

import {
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  UseGuards,
  type CanActivate,
} from "../src/common";
import { TechneFactory } from "../src/core";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

@Injectable()
class AllowAllGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class SlowService {
  getAll() {
    return [{ id: 1, name: "Alice" }];
  }
  getOne(id: string) {
    return { id, name: "Alice" };
  }
}

@Controller("users")
@UseGuards(AllowAllGuard)
class SlowController {
  constructor(private svc: SlowService) {}

  @Get("/")
  findAll() {
    return this.svc.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.svc.getOne(id);
  }
}

@Module({ controllers: [SlowController], providers: [SlowService, AllowAllGuard] })
class SlowModule {}

const bnestApp = await TechneFactory.create(SlowModule, { logger: false });

export async function runSlowPathBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  const requests = [
    { label: "GET /users (guarded)", make: () => new Request("http://localhost/users") },
    { label: "GET /users/:id (guarded)", make: () => new Request("http://localhost/users/42") },
  ];

  const out: ScenarioResult[] = [];
  for (const req of requests) {
    out.push(await runScenario("Techne (slow)", (r) => bnestApp.handle(r), req, opts));
  }
  return out;
}

if (import.meta.main) {
  const results = await runSlowPathBench();
  emitResults(results);
}
