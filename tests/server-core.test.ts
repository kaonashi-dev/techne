import { describe, expect, test } from "bun:test";
import { createApp, status, t, ValidationError } from "../src";
import { problem } from "../src/server";

const get = (app: { handle(r: Request): Promise<Response> }, path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init));

describe("server core: routing", () => {
  test("static, param, optional param and wildcard routes", async () => {
    const app = createApp()
      .get("/a", () => "static")
      .get("/users/:id", ({ params }) => params.id)
      .get("/posts/:slug?", ({ params }) => params.slug ?? "none")
      .get("/files/*", ({ params }) => params["*"]);
    expect(await (await get(app, "/a")).text()).toBe("static");
    expect(await (await get(app, "/users/a%20b")).text()).toBe("a b");
    expect(await (await get(app, "/posts")).text()).toBe("none");
    expect(await (await get(app, "/posts/hi")).text()).toBe("hi");
    expect(await (await get(app, "/files/x/y.txt")).text()).toBe("x/y.txt");
  });

  test("trailing slashes match unless strictPath is set", async () => {
    const loose = createApp().get("/a", () => "ok");
    const strict = createApp({ strictPath: true }).get("/a", () => "ok");
    expect((await get(loose, "/a/")).status).toBe(200);
    expect((await get(strict, "/a/")).status).toBe(404);
  });

  test("unknown routes are 404 problem documents; HEAD falls back to GET", async () => {
    const app = createApp().get("/a", () => "ok");
    const missing = await get(app, "/nope");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/problem+json");
    expect(await missing.json()).toMatchObject({ type: "not-found", status: 404 });
    expect((await get(app, "/a", { method: "HEAD" })).status).toBe(200);
  });

  test("prefixes compose through nested use()", async () => {
    const inner = createApp({ prefix: "/v1" })
      .get("/", () => "root")
      .get("/x", () => "x");
    const app = createApp({ prefix: "/api" }).use(inner);
    expect(await (await get(app, "/api/v1")).text()).toBe("root");
    expect(await (await get(app, "/api/v1/x")).text()).toBe("x");
  });
});

describe("server core: validation and parsing", () => {
  test("coerces params and query, rejects invalid bodies with 422", async () => {
    const app = createApp()
      .get(
        "/n/:id",
        { params: t.Object({ id: t.Number() }), query: t.Object({ page: t.Number() }) },
        ({ params, query }) => ({ id: params.id, page: query.page }),
      )
      .post("/b", { body: t.Object({ name: t.String() }) }, ({ body }) => body);
    expect(await (await get(app, "/n/7?page=2")).json()).toEqual({ id: 7, page: 2 });
    expect((await get(app, "/n/x?page=2")).status).toBe(422);
    const invalid = await get(app, "/b", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 1 }),
    });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ type: "validation", on: "body" });
  });

  test("malformed JSON is a 400; an empty JSON body is undefined", async () => {
    const app = createApp().post("/b", ({ body }) => ({ empty: body === undefined }));
    const post = (body: string) =>
      get(app, "/b", { method: "POST", headers: { "content-type": "application/json" }, body });
    expect((await post("{")).status).toBe(400);
    expect(await (await post("")).json()).toEqual({ empty: true });
  });

  test("parses url-encoded and multipart bodies into objects", async () => {
    const app = createApp().post("/f", ({ body }) => body);
    const form = new FormData();
    form.append("a", "1");
    form.append("tag", "x");
    form.append("tag", "y");
    expect(await (await get(app, "/f", { method: "POST", body: form })).json()).toEqual({
      a: "1",
      tag: ["x", "y"],
    });
    const encoded = await get(app, "/f", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "q=a+b&n=%31",
    });
    expect(await encoded.json()).toEqual({ q: "a b", n: "1" });
  });
});

describe("server core: hooks", () => {
  test("hooks apply regardless of registration order", async () => {
    const app = createApp()
      .get("/a", () => "ok")
      .afterHandle(({ set }) => {
        set.headers["x-after"] = "1";
      });
    expect((await get(app, "/a")).headers.get("x-after")).toBe("1");
  });

  test("local hooks stay local; scoped lifts one level; global lifts to the root", async () => {
    const mark = (name: string, as: "local" | "scoped" | "global") =>
      createApp({ as }).afterHandle(({ set }) => {
        set.headers[`x-${name}`] = "1";
      });
    const feature = createApp({ prefix: "/f" })
      .use(mark("local", "local"))
      .use(mark("scoped", "scoped"))
      .use(mark("global", "global"))
      .get("/", () => "f");
    const app = createApp()
      .get("/root", () => "r")
      .use(createApp().use(feature));
    const f = await get(app, "/f");
    expect([
      f.headers.get("x-local"),
      f.headers.get("x-scoped"),
      f.headers.get("x-global"),
    ]).toEqual([null, "1", "1"]);
    const root = await get(app, "/root");
    expect([root.headers.get("x-scoped"), root.headers.get("x-global")]).toEqual([null, "1"]);
  });

  test("named apps mount once", async () => {
    let calls = 0;
    const counter = () =>
      createApp({ name: "counter", as: "global" }).beforeHandle(() => void calls++);
    const app = createApp()
      .use(counter())
      .use(counter())
      .get("/", () => "ok");
    await get(app, "/");
    expect(calls).toBe(1);
  });

  test("request hooks short-circuit; derive and decorate extend the context", async () => {
    const app = createApp()
      .decorate("greeting", "hi")
      .request(({ request }) => (request.headers.has("x-stop") ? status(418) : undefined))
      .derive(({ headers }) => ({ who: headers["x-who"] ?? "anon" }))
      .get("/", ({ greeting, who }) => `${greeting} ${who}`);
    expect(await (await get(app, "/", { headers: { "x-who": "Ada" } })).text()).toBe("hi Ada");
    expect((await get(app, "/", { headers: { "x-stop": "1" } })).status).toBe(418);
  });

  test("afterHandle replaces the value; mapResponse can return a Response", async () => {
    const app = createApp()
      .afterHandle(({ response }) => ({ wrapped: response }))
      .mapResponse(({ response }) => new Response(JSON.stringify(response), { status: 203 }))
      .get("/", () => 1);
    const res = await get(app, "/");
    expect(res.status).toBe(203);
    expect(await res.json()).toEqual({ wrapped: 1 });
  });

  test("error(Class) matches by class; thrown status results respond directly", async () => {
    class Domain extends Error {}
    const app = createApp()
      .error(Domain, () => problem(409, { detail: "domain" }))
      .get("/domain", () => {
        throw new Domain();
      })
      .get("/status", () => {
        throw status(402, "pay");
      })
      .get("/boom", () => {
        throw new Error("boom");
      });
    expect((await get(app, "/domain")).status).toBe(409);
    expect(await (await get(app, "/status")).text()).toBe("pay");
    const boom = await get(app, "/boom");
    expect(boom.status).toBe(500);
    expect(await boom.json()).toMatchObject({ type: "internal-server-error", detail: "boom" });
  });

  test("ValidationError reaches error hooks", async () => {
    let seen: unknown;
    const app = createApp()
      .error(ValidationError, ({ error }) => {
        seen = error.type;
        return status(400, "bad");
      })
      .get("/:n", { params: t.Object({ n: t.Number() }) }, ({ params }) => params.n);
    expect((await get(app, "/x")).status).toBe(400);
    expect(seen).toBe("params");
  });

  test("async hooks and handlers run in order", async () => {
    const order: string[] = [];
    const app = createApp()
      .beforeHandle(async () => {
        await Bun.sleep(1);
        order.push("before");
      })
      .afterResponse(() => void order.push("afterResponse"))
      .get("/", async () => {
        order.push("handler");
        return "ok";
      });
    expect(await (await get(app, "/")).text()).toBe("ok");
    await Bun.sleep(1);
    expect(order).toEqual(["before", "handler", "afterResponse"]);
  });
});

describe("server core: responses", () => {
  test("set.status and set.headers apply to values and returned Responses", async () => {
    const app = createApp()
      .get("/v", ({ set }) => {
        set.status = "Created";
        set.headers["x-a"] = "1";
        return { ok: true };
      })
      .get("/r", ({ set }) => {
        set.headers["x-a"] = "1";
        return new Response("raw", { headers: { "x-b": "2" } });
      });
    const v = await get(app, "/v");
    expect([v.status, v.headers.get("x-a"), v.headers.get("content-type")]).toEqual([
      201,
      "1",
      "application/json;charset=utf-8",
    ]);
    const r = await get(app, "/r");
    expect([r.headers.get("x-a"), r.headers.get("x-b"), await r.text()]).toEqual(["1", "2", "raw"]);
  });

  test("static value routes are served without a handler", async () => {
    const app = createApp().get("/s", { ok: true }).get("/t", "text");
    expect(await (await get(app, "/s")).json()).toEqual({ ok: true });
    expect(await (await get(app, "/s")).json()).toEqual({ ok: true });
    expect(await (await get(app, "/t")).text()).toBe("text");
  });

  test("cookies are read, written and signed", async () => {
    const app = createApp({ cookie: { secrets: "s3cret", sign: ["session"] } })
      .get("/set", ({ cookie }) => {
        cookie.session!.set({ value: "abc", httpOnly: true, path: "/" });
        return "ok";
      })
      .get("/read", ({ cookie }) => cookie.session!.value ?? "none");
    const set = await get(app, "/set");
    const header = set.headers.get("set-cookie")!;
    expect(header).toContain("HttpOnly");
    const signed = header.split(";")[0]!;
    expect(signed.startsWith("session=abc.")).toBe(true);
    expect(await (await get(app, "/read", { headers: { cookie: signed } })).text()).toBe("abc");
    expect((await get(app, "/read", { headers: { cookie: "session=abc.forged" } })).status).toBe(
      401,
    );
  });

  test("listen() serves over a socket and stop() runs cleanups", async () => {
    let cleaned = false;
    const app = createApp()
      .get("/", () => "socket")
      .cleanup(() => {
        cleaned = true;
      })
      .listen({ port: 0, hostname: "127.0.0.1" });
    try {
      expect(await (await fetch(`http://127.0.0.1:${app.server!.port}/`)).text()).toBe("socket");
    } finally {
      await app.stop();
    }
    expect(cleaned).toBe(true);
  });
});
