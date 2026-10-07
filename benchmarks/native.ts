/**
 * Same route builder, dependencies and native hooks for both constructors.
 * Measures in-process Request/Response dispatch, not socket throughput.
 */
import { Elysia, t } from "elysia";
import { createApp } from "../src";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

function routes(app: Elysia) {
  const users = { find: (id: string) => ({ id, name: "Ada" }) };
  return app
    .get("/static", { message: "hello" })
    .get("/users/:id", ({ params }) => users.find(params.id))
    .post(
      "/users",
      {
        body: t.Object({ name: t.String({ minLength: 1 }) }),
        response: t.Object({ name: t.String() }),
      },
      ({ body }) => ({ name: body.name }),
    )
    .use(
      new Elysia({ prefix: "/guarded" })
        .beforeHandle(({ headers, status }) => {
          if (headers.authorization !== "Bearer bench") return status(401);
        })
        .get("/", () => ({ ok: true })),
    );
}

export async function runNativeBench(): Promise<ScenarioResult[]> {
  const apps = [
    { name: "Elysia native", app: routes(new Elysia({ precompile: true })) },
    { name: "Techne native", app: routes(createApp()) },
  ];
  const requests = [
    { label: "static JSON", make: () => new Request("http://localhost/static") },
    { label: "params + service", make: () => new Request("http://localhost/users/42") },
    {
      label: "validated JSON",
      make: () =>
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Ada" }),
        }),
    },
    {
      label: "native guard",
      make: () =>
        new Request("http://localhost/guarded", {
          headers: { authorization: "Bearer bench" },
        }),
    },
  ];
  const results: ScenarioResult[] = [];
  for (const [index, request] of requests.entries()) {
    // Validate parity before timing; otherwise a fast error response can win.
    const responses = await Promise.all(apps.map(({ app }) => app.handle(request.make())));
    const payloads = await Promise.all(responses.map((response) => response.text()));
    if (responses.some((response) => response.status !== 200) || payloads[0] !== payloads[1]) {
      throw new Error(`Response mismatch in ${request.label}`);
    }
    // Alternate order to reduce systematic first-run bias.
    for (const { name, app } of index % 2 === 0 ? apps : [...apps].reverse()) {
      results.push(
        await runScenario(name, (request) => app.handle(request), request, getDefaults(isQuick())),
      );
    }
  }
  return results;
}

if (import.meta.main) emitResults(await runNativeBench());
