/**
 * Validation benchmark.
 *
 * A POST route with a TypeBox `body` schema. We measure two variants:
 *  - valid body: the happy path; validation passes and the handler runs.
 *  - invalid body: validation fails and an error response is produced.
 *
 * The invalid-body variant matters because failed-validation throughput
 * is dominated by error construction; if it collapses below the valid
 * path the validator is probably building rich error messages eagerly.
 */

import { Body, Controller, Injectable, Module, Post, Schema } from "../src/common";
import { BnestFactory } from "../src/core";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

const CreateUserSchema = Schema.Object({
  name: Schema.String(),
  age: Schema.Number(),
});

@Injectable()
class ValidationService {
  create(user: { name: string; age: number }) {
    return { id: 1, ...user };
  }
}

@Controller("users")
class ValidationController {
  constructor(private svc: ValidationService) {}

  @Post("/", { body: CreateUserSchema })
  create(@Body() body: { name: string; age: number }) {
    return this.svc.create(body);
  }
}

@Module({ controllers: [ValidationController], providers: [ValidationService] })
class ValidationModule {}

const bnestApp = await BnestFactory.create(ValidationModule, { logger: false });

const validBody = JSON.stringify({ name: "Alice", age: 30 });
const invalidBody = JSON.stringify({ name: "Alice" }); // missing `age`

function makeReq(body: string): Request {
  return new Request("http://localhost/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

export async function runValidationBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  const requests = [
    { label: "POST /users (valid)", make: () => makeReq(validBody) },
    { label: "POST /users (invalid)", make: () => makeReq(invalidBody) },
  ];

  const out: ScenarioResult[] = [];
  for (const req of requests) {
    out.push(await runScenario("Bnest (validation)", (r) => bnestApp.handle(r), req, opts));
  }
  return out;
}

if (import.meta.main) {
  const results = await runValidationBench();
  emitResults(results);
}
