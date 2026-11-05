import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { App, createApp, problem, status, t } from "../src";

describe("native composition", () => {
  test("keeps legacy and optional subsystems out of the root dependency graph", async () => {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
      target: "bun",
      metafile: true,
    });
    expect(build.success).toBe(true);
    expect(build.metafile).toBeDefined();
    const inputs = Object.keys(build.metafile!.inputs);
    const legacy =
      /(?:^|\/)src\/(?:core|factory|decorators|platform|cli|mq|queue|cqrs|console|telemetry|prisma|testing)\//;
    expect(inputs.filter((input) => legacy.test(input))).toEqual([]);
  });

  test("returns a Techne App with its options", () => {
    const app = createApp({ prefix: "/api", strictPath: true });
    expect(app).toBeInstanceOf(App);
    expect(app.config).toMatchObject({ prefix: "/api", strictPath: true });
  });

  test("composes typed routes with explicit dependencies and native validation", async () => {
    const calls: string[] = [];
    const users = (service: { create(name: string): { id: number; name: string } }) =>
      createApp({ prefix: "/users" }).post(
        "/",
        {
          body: t.Object({ name: t.String({ minLength: 1 }) }),
          response: { 201: t.Object({ id: t.Number(), name: t.String() }) },
        },
        ({ body }) => status(201, service.create(body.name)),
      );
    const app = createApp().use(
      users({
        create(name) {
          calls.push(name);
          return { id: 1, name };
        },
      }),
    );
    const post = (body: unknown) =>
      app.handle(
        new Request("http://localhost/users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const response = await post({ name: "Ada" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 1, name: "Ada" });
    expect((await post({ name: "" })).status).toBe(422);
    expect(calls).toEqual(["Ada"]);
  });

  test("preserves plugin scope, request-local context and native responses", async () => {
    const privateRoutes = createApp({ prefix: "/private" })
      .derive(({ headers }) => ({ user: headers["x-user"] }))
      .beforeHandle(({ user }) => {
        if (!user) return problem(401, { detail: "Sign in first" });
      })
      .get("/me", async ({ user }) => {
        await Promise.resolve();
        return { user };
      });
    const app = createApp()
      .use(privateRoutes)
      .get("/public", () => new Response("public", { headers: { "x-native": "yes" } }));
    const denied = await app.handle(new Request("http://localhost/private/me"));
    expect(denied.status).toBe(401);
    expect(denied.headers.get("content-type")).toContain("application/problem+json");
    const responses = await Promise.all(
      ["Ada", "Lin"].map((user) =>
        app.handle(new Request("http://localhost/private/me", { headers: { "x-user": user } })),
      ),
    );
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      { user: "Ada" },
      { user: "Lin" },
    ]);
    const publicResponse = await app.handle(new Request("http://localhost/public"));
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("x-native")).toBe("yes");
    expect(await publicResponse.text()).toBe("public");
  });

  test("supports listening, fetching and stopping", async () => {
    let stopped = false;
    const app = createApp()
      .get("/", () => "native")
      .cleanup(() => {
        stopped = true;
      })
      .listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const response = await fetch(`http://127.0.0.1:${app.server!.port}/`);
      expect(await response.text()).toBe("native");
    } finally {
      await app.stop();
    }
    expect(stopped).toBe(true);
  });

  test("root import does not initialize the decorator metadata runtime", async () => {
    const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `await import(${JSON.stringify(entry)}); if (Reflect.defineMetadata) process.exit(1);`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await child.exited).toBe(0);
  });
});
