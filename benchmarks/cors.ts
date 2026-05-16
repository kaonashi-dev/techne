/**
 * CORS benchmark.
 *
 * Exercises the adapter CORS hook with non-static origins. The hot operation
 * is `createCorsHeaders`: dynamic origins should hit the per-origin cache
 * after the first request instead of allocating a merged header record every
 * time.
 */

import { Controller, Get } from "../src/common";
import { TechneFactory } from "../src/core";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

@Controller("cors")
class CorsController {
  @Get("/")
  ok() {
    return { ok: true };
  }
}

const allowListApp = await TechneFactory.create({
  controllers: [CorsController],
  logger: false,
  cors: {
    origin: ["https://app.example", "https://admin.example"],
    credentials: true,
  },
});

const echoAnyApp = await TechneFactory.create({
  controllers: [CorsController],
  logger: false,
  cors: {
    origin: true,
    credentials: true,
  },
});

export async function runCorsBench(): Promise<ScenarioResult[]> {
  const opts = getDefaults(isQuick());
  return [
    await runScenario(
      "Techne (CORS)",
      (r) => allowListApp.handle(r),
      {
        label: "GET /cors (allow-list origin)",
        make: () =>
          new Request("http://localhost/cors", {
            headers: { origin: "https://app.example" },
          }),
      },
      opts,
    ),
    await runScenario(
      "Techne (CORS)",
      (r) => echoAnyApp.handle(r),
      {
        label: "GET /cors (echo origin)",
        make: () =>
          new Request("http://localhost/cors", {
            headers: { origin: "https://tenant.example" },
          }),
      },
      opts,
    ),
  ];
}

if (import.meta.main) {
  const results = await runCorsBench();
  emitResults(results);
}
