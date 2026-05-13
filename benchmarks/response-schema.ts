/**
 * Response-schema benchmark.
 *
 * Exercises the fast TypeBox stringifier (`src/schema/fast-stringify.ts`)
 * by declaring a `response` schema on a route. The schema-driven stringifier
 * pre-encodes property keys and avoids the generic property enumeration
 * cost of `JSON.stringify`, so it should at least match — and usually
 * beat — a route returning the same payload without a schema.
 *
 * Validation strategy:
 *  - "with response schema": Bnest stringifies via the compiled stringifier.
 *  - "no response schema":   Bnest stringifies via Elysia's default path
 *                            (which delegates to `JSON.stringify`).
 *
 * The first should be ≥ the second.
 */

import { Controller, Get, Injectable, Module, Schema } from "../src/common";
import { BnestFactory } from "../src/core";
import {
  emitResults,
  getDefaults,
  isJson,
  isQuick,
  runScenario,
  type ScenarioResult,
} from "./scenarios";

const UserSchema = Schema.Object({
  id: Schema.Number(),
  name: Schema.String(),
  email: Schema.String(),
  age: Schema.Number(),
  active: Schema.Boolean(),
});

const PAYLOAD = {
  id: 1,
  name: "Alice",
  email: "alice@example.com",
  age: 30,
  active: true,
};

@Injectable()
class UserService {
  get() {
    return PAYLOAD;
  }
}

@Controller("users")
class WithSchemaController {
  constructor(private svc: UserService) {}

  @Get("/typed", { response: UserSchema })
  typed() {
    return this.svc.get();
  }

  @Get("/plain")
  plain() {
    return this.svc.get();
  }
}

@Module({ controllers: [WithSchemaController], providers: [UserService] })
class RespModule {}

const bnestApp = await BnestFactory.create(RespModule, { logger: false });

export async function runResponseSchemaBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  const requests = [
    {
      label: "GET /users/typed (schema)",
      make: () => new Request("http://localhost/users/typed"),
    },
    {
      label: "GET /users/plain (no schema)",
      make: () => new Request("http://localhost/users/plain"),
    },
  ];

  const out: ScenarioResult[] = [];
  for (const req of requests) {
    out.push(await runScenario("Bnest (response)", (r) => bnestApp.handle(r), req, opts));
  }
  return out;
}

if (import.meta.main) {
  const results = await runResponseSchemaBench();
  emitResults(results);

  // Heuristic gate: emit a warning (not a failure) if the schema-typed route
  // didn't at least match the plain route. Helpful when iterating on the
  // stringifier — a regression here usually means the fast path stopped firing.
  const typed = results.find((r) => r.request.includes("schema)") && !r.request.includes("no"));
  const plain = results.find((r) => r.request.includes("(no schema)"));
  if (typed && plain && typed.rps < plain.rps * 0.95 && !isJson()) {
    console.log(
      `\nNote: schema-typed route (${Math.round(typed.rps)} req/s) is below plain JSON ` +
        `(${Math.round(plain.rps)} req/s). The fast stringifier may not be firing.`,
    );
  }
}
