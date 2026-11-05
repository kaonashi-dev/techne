/**
 * The same four routes as a Techne native app and as a hand-written `fetch`
 * handler (the floor: routing, validation and serialization done by hand).
 * Measures in-process Request/Response dispatch, not socket throughput.
 */
import { createApp, t } from "../src";
import { emitResults, getDefaults, isQuick, runScenario, type ScenarioResult } from "./scenarios";

const users = { find: (id: string) => ({ id, name: "Ada" }) };

function nativeApp() {
  return createApp()
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
      createApp({ prefix: "/guarded" })
        .beforeHandle(({ headers, status }) => {
          if (headers.authorization !== "Bearer bench") return status(401);
        })
        .get("/", () => ({ ok: true })),
    );
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

const rawApp = {
  async handle(request: Request): Promise<Response> {
    const url = request.url;
    const path = url.slice(url.indexOf("/", url.indexOf("://") + 3));
    if (request.method === "GET" && path === "/static") return json({ message: "hello" });
    if (request.method === "GET" && path.startsWith("/users/")) {
      return json(users.find(decodeURIComponent(path.slice(7))));
    }
    if (request.method === "POST" && path === "/users") {
      const body = (await request.json()) as { name?: unknown };
      if (typeof body?.name !== "string" || body.name.length < 1) return json({}, 422);
      return json({ name: body.name });
    }
    if (request.method === "GET" && path === "/guarded") {
      if (request.headers.get("authorization") !== "Bearer bench") return json({}, 401);
      return json({ ok: true });
    }
    return json({}, 404);
  },
};

export async function runNativeBench(): Promise<ScenarioResult[]> {
  const apps = [
    { name: "Raw fetch handler", app: rawApp },
    { name: "Techne native", app: nativeApp() },
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
