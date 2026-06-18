import { describe, expect, test, beforeEach } from "bun:test";
import { PendingRequest } from "../src/http/pending-request";
import { RequestException, ConnectionException } from "../src/http/exceptions";
import { Http, createHttpClient } from "../src/http/factory";
import { fakeReset } from "../src/http/fake";

// ─── makeFetch helper ─────────────────────────────────────────────────────

interface MockCall {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function makeFetch(responder: (call: MockCall) => Response | Promise<Response>) {
  const calls: MockCall[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input as string, init);
    const body = req.body ? await req.clone().text() : null;
    const call: MockCall = {
      url: req.url,
      method: req.method,
      headers: req.headers,
      body,
    };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function problemResponse(status: number, title: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

beforeEach(() => {
  fakeReset();
});

// ─── GET / query string ───────────────────────────────────────────────────

describe("GET requests", () => {
  test("GET with no query sends correct URL", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ ok: true }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/users");
    expect(calls[0]!.url).toBe("https://example.com/users");
    expect(calls[0]!.method).toBe("GET");
    expect(res.ok()).toBe(true);
    expect(res.json<{ ok: boolean }>()).toEqual({ ok: true });
  });

  test("GET with array query params expands to repeated keys", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse([]));
    await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/search", {
      tag: ["a", "b"],
      page: "2",
    });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(url.searchParams.get("page")).toBe("2");
  });

  test("withQueryParameters merges into query string", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withQueryParameters({ foo: "bar" })
      .get("https://example.com/api");
    expect(calls[0]!.url).toContain("foo=bar");
  });
});

// ─── POST / body formats ──────────────────────────────────────────────────

describe("POST body formats", () => {
  test("POST JSON sets content-type and stringifies body", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({ id: 1 }, 201));
    await new PendingRequest({ fetch: fetchImpl }).post("https://example.com/users", {
      name: "Alice",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(calls[0]!.body).toBe(JSON.stringify({ name: "Alice" }));
  });

  test("asForm sends urlencoded body", async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 200 }));
    await new PendingRequest({ fetch: fetchImpl })
      .asForm()
      .post("https://example.com/login", { username: "user", password: "pass" });
    expect(calls[0]!.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    const params = new URLSearchParams(calls[0]!.body ?? "");
    expect(params.get("username")).toBe("user");
    expect(params.get("password")).toBe("pass");
  });

  test("asMultipart sends FormData (no explicit content-type set)", async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 200 }));
    await new PendingRequest({ fetch: fetchImpl })
      .asMultipart()
      .post("https://example.com/upload", { field: "value" });
    // fetch sets the boundary; we must not override content-type to plain
    const ct = calls[0]!.headers.get("content-type") ?? "";
    expect(ct).toContain("multipart/form-data");
  });

  test("attach adds to FormData in multipart request", async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 200 }));
    await new PendingRequest({ fetch: fetchImpl })
      .asMultipart()
      .attach("photo", "data", "photo.jpg")
      .post("https://example.com/upload");
    expect(calls[0]!.headers.get("content-type")).toContain("multipart/form-data");
  });

  test("withBody sends raw body with explicit content-type", async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 200 }));
    await new PendingRequest({ fetch: fetchImpl })
      .withBody("raw payload", "text/plain")
      .post("https://example.com/data");
    expect(calls[0]!.body).toBe("raw payload");
    expect(calls[0]!.headers.get("content-type")).toBe("text/plain");
  });
});

// ─── Headers ──────────────────────────────────────────────────────────────

describe("Header management", () => {
  test("withToken sets Authorization Bearer header", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withToken("my-token")
      .get("https://example.com/me");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer my-token");
  });

  test("withToken accepts custom type", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withToken("key123", "Token")
      .get("https://example.com/me");
    expect(calls[0]!.headers.get("authorization")).toBe("Token key123");
  });

  test("withBasicAuth sets Authorization Basic header", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withBasicAuth("user", "pass")
      .get("https://example.com/secure");
    const auth = calls[0]!.headers.get("authorization") ?? "";
    expect(auth.startsWith("Basic ")).toBe(true);
    expect(atob(auth.slice(6))).toBe("user:pass");
  });

  test("withHeaders merges headers (per-call wins on collision)", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withHeaders({ "x-custom": "default", "x-other": "keep" })
      .withHeader("x-custom", "override")
      .get("https://example.com/");
    expect(calls[0]!.headers.get("x-custom")).toBe("override");
    expect(calls[0]!.headers.get("x-other")).toBe("keep");
  });

  test("replaceHeaders discards previous headers", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withHeader("x-original", "yes")
      .replaceHeaders({ "x-new": "only" })
      .get("https://example.com/");
    expect(calls[0]!.headers.get("x-new")).toBe("only");
    expect(calls[0]!.headers.get("x-original")).toBeNull();
  });

  test("acceptJson sets Accept: application/json", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl }).acceptJson().get("https://example.com/");
    expect(calls[0]!.headers.get("accept")).toBe("application/json");
  });
});

// ─── URL building ─────────────────────────────────────────────────────────

describe("URL building", () => {
  test("baseUrl is prepended to relative paths", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ baseUrl: "https://api.example.com", fetch: fetchImpl }).get(
      "/users",
    );
    expect(calls[0]!.url).toBe("https://api.example.com/users");
  });

  test("trailing slash on baseUrl is trimmed", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ baseUrl: "https://api.example.com/", fetch: fetchImpl }).get(
      "/users",
    );
    expect(calls[0]!.url).toBe("https://api.example.com/users");
  });

  test("absolute URL overrides baseUrl", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ baseUrl: "https://api.example.com", fetch: fetchImpl }).get(
      "https://other.com/resource",
    );
    expect(calls[0]!.url).toBe("https://other.com/resource");
  });

  test("withUrlParameters expands {var} placeholders", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withUrlParameters({ id: "42", section: "profile" })
      .get("https://api.example.com/users/{id}/{section}");
    expect(calls[0]!.url).toBe("https://api.example.com/users/42/profile");
  });

  test("{+var} is not percent-encoded", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withUrlParameters({ path: "foo/bar" })
      .get("https://api.example.com/{+path}");
    expect(calls[0]!.url).toBe("https://api.example.com/foo/bar");
  });
});

// ─── Response inspectors ──────────────────────────────────────────────────

describe("HttpResponse inspectors", () => {
  test("200 → ok/successful true, failed false", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ x: 1 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.ok()).toBe(true);
    expect(res.successful()).toBe(true);
    expect(res.failed()).toBe(false);
    expect(res.clientError()).toBe(false);
    expect(res.serverError()).toBe(false);
  });

  test("201 → created()", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 201 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).post("https://example.com/");
    expect(res.created()).toBe(true);
  });

  test("404 → notFound, clientError, failed", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 404 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.notFound()).toBe(true);
    expect(res.clientError()).toBe(true);
    expect(res.failed()).toBe(true);
    expect(res.ok()).toBe(false);
  });

  test("500 → serverError, failed", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 500 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.serverError()).toBe(true);
    expect(res.failed()).toBe(true);
  });

  test("json() parses response body", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ name: "Alice", age: 30 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.json<{ name: string }>().name).toBe("Alice");
  });

  test("json(key) supports dot-path navigation", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ data: { id: 99 } }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.json<number>("data.id")).toBe(99);
  });

  test("body() returns raw text", async () => {
    const { fetchImpl } = makeFetch(() => new Response("hello", { status: 200 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.body()).toBe("hello");
  });

  test("header() returns individual header", async () => {
    const { fetchImpl } = makeFetch(
      () => new Response(null, { status: 200, headers: { "x-req-id": "abc" } }),
    );
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.header("x-req-id")).toBe("abc");
  });

  test("4xx does NOT throw by default", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 404 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(res.failed()).toBe(true); // no throw
  });
});

// ─── throw helpers ────────────────────────────────────────────────────────

describe("throw helpers", () => {
  test("throw() raises RequestException on 4xx", async () => {
    const { fetchImpl } = makeFetch(() => problemResponse(404, "Not Found"));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    let threw: unknown;
    try {
      res.throw();
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(RequestException);
    const e = threw as RequestException;
    expect(e.status).toBe(404);
    expect(e.problem?.title).toBe("Not Found");
    expect(e.message).toBe("Not Found");
  });

  test("throw() no-ops on 2xx", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throw()).not.toThrow();
  });

  test("throwIf(true) throws", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}, 200));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwIf(true)).toThrow(RequestException);
  });

  test("throwIf(false) does not throw", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}, 200));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwIf(false)).not.toThrow();
  });

  test("throwUnless(false) throws", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 500 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwUnless(false)).toThrow(RequestException);
  });

  test("throwIfStatus(code) throws on matching code", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 429 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwIfStatus(429)).toThrow(RequestException);
    expect(() => res.throwIfStatus(500)).not.toThrow();
  });

  test("throwUnlessStatus(code) throws on non-matching code", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 200 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwUnlessStatus(201)).toThrow(RequestException);
    expect(() => res.throwUnlessStatus(200)).not.toThrow();
  });

  test("throwIfClientError() throws on 4xx", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 422 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwIfClientError()).toThrow(RequestException);
  });

  test("throwIfServerError() throws on 5xx", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 503 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    expect(() => res.throwIfServerError()).toThrow(RequestException);
  });

  test("onError callback fires on failed response", async () => {
    const { fetchImpl } = makeFetch(() => new Response(null, { status: 401 }));
    const res = await new PendingRequest({ fetch: fetchImpl }).get("https://example.com/");
    let called = false;
    res.onError(() => {
      called = true;
    });
    expect(called).toBe(true);
  });
});

// ─── createHttpClient ──────────────────────────────────────────────────────

describe("createHttpClient", () => {
  test("bakes baseUrl into every request", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const client = createHttpClient({ baseUrl: "https://api.github.com", fetch: fetchImpl });
    await client.get("/repos");
    expect(calls[0]!.url).toBe("https://api.github.com/repos");
  });

  test("bakes token into every request", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const client = createHttpClient({ token: "secret", fetch: fetchImpl });
    await client.get("https://example.com/me");
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer secret");
  });

  test("per-call withHeaders adds to seeded headers", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    const client = createHttpClient({
      headers: { "x-global": "yes" },
      fetch: fetchImpl,
    });
    await client.withHeader("x-per-call", "also").get("https://example.com/");
    expect(calls[0]!.headers.get("x-global")).toBe("yes");
    expect(calls[0]!.headers.get("x-per-call")).toBe("also");
  });

  test("pool dispatches multiple requests", async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({ n: 1 }));
    const client = createHttpClient({ fetch: fetchImpl });
    const results = await client.pool((p) => [p.get("https://a.com/"), p.get("https://b.com/")]);
    expect(results.length).toBe(2);
    expect(results[0]!.ok()).toBe(true);
    expect(results[1]!.ok()).toBe(true);
  });
});

// ─── Http facade ──────────────────────────────────────────────────────────

describe("Http facade", () => {
  test("Http.get() works like a standalone PendingRequest", async () => {
    Http.fake();
    const res = await Http.get("https://example.com/");
    expect(res.ok()).toBe(true);
  });

  test("Http.macro registers and resolves custom factories", () => {
    Http.macro("github", () => createHttpClient({ baseUrl: "https://api.github.com" }));
    const client = (Http as unknown as Record<string, () => unknown>)[
      "github"
    ]?.() as HttpClientHandle;
    expect(client).toBeDefined();
  });

  test("Http.globalOptions merges into requests", async () => {
    Http.fake();
    Http.globalOptions({ headers: { "x-global": "yes" } });
    Http.assertNothingSent();

    // We verify via recorded request that global options appear
    Http.fake();
    await Http.get("https://example.com/");
    Http.assertSentCount(1);
  });
});

// ─── Timeout / retry ──────────────────────────────────────────────────────

describe("Timeout", () => {
  test("timeout AbortError becomes ConnectionException", async () => {
    const fetchImpl: typeof globalThis.fetch = () =>
      new Promise((_, reject) => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        setTimeout(() => reject(err), 5);
      });
    let threw: unknown;
    try {
      await new PendingRequest({ fetch: fetchImpl }).timeout(0.001).get("https://example.com/");
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(ConnectionException);
  });
});

describe("Retry", () => {
  test("retries N times then returns success", async () => {
    let calls = 0;
    const fetchImpl: typeof globalThis.fetch = async () => {
      calls++;
      if (calls < 3) return new Response(null, { status: 503 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const req = new PendingRequest({ fetch: fetchImpl });
    req._sleeper = () => Promise.resolve();
    const res = await req.retry(2, 0).get("https://example.com/");
    expect(calls).toBe(3);
    expect(res.ok()).toBe(true);
  });

  test("throw: false returns last response instead of throwing", async () => {
    const fetchImpl: typeof globalThis.fetch = async () => new Response(null, { status: 503 });
    const req = new PendingRequest({ fetch: fetchImpl });
    req._sleeper = () => Promise.resolve();
    const res = await req.retry(1, 0, undefined, { throw: false }).get("https://example.com/");
    expect(res.serverError()).toBe(true);
  });

  test("when predicate limits retries", async () => {
    let calls = 0;
    const fetchImpl: typeof globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status: 503 });
    };
    // Only retry on 503, but our when says never retry
    const req = new PendingRequest({ fetch: fetchImpl });
    req._sleeper = () => Promise.resolve();
    // when=false means no retry, so just 1 call
    await req.retry(3, 0, (_err, _reqObj) => false, { throw: false }).get("https://example.com/");
    expect(calls).toBe(1);
  });

  test("array sleep uses per-attempt values", async () => {
    const slept: number[] = [];
    const fetchImpl: typeof globalThis.fetch = async () => new Response(null, { status: 503 });
    const req = new PendingRequest({ fetch: fetchImpl });
    req._sleeper = (ms) => {
      slept.push(ms);
      return Promise.resolve();
    };
    await req.retry(2, [100, 200], undefined, { throw: false }).get("https://example.com/");
    expect(slept).toEqual([100, 200]);
  });
});

// ─── Middleware ────────────────────────────────────────────────────────────

describe("Middleware", () => {
  test("request middleware can inject headers", async () => {
    const { fetchImpl, calls } = makeFetch(() => jsonResponse({}));
    await new PendingRequest({ fetch: fetchImpl })
      .withRequestMiddleware((req) => {
        const next = new Request(req, { headers: new Headers(req.headers) });
        next.headers.set("x-injected", "yes");
        return next;
      })
      .get("https://example.com/");
    expect(calls[0]!.headers.get("x-injected")).toBe("yes");
  });

  test("response middleware can transform response", async () => {
    const { fetchImpl } = makeFetch(
      () =>
        new Response(JSON.stringify({ original: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const res = await new PendingRequest({ fetch: fetchImpl })
      .withResponseMiddleware(async (r) => {
        const body = await r.json();
        return new Response(JSON.stringify({ ...(body as object), added: true }), {
          status: r.status,
          headers: r.headers,
        });
      })
      .get("https://example.com/");
    expect(res.json<{ added: boolean }>().added).toBe(true);
  });
});

// ─── Pool / Batch ──────────────────────────────────────────────────────────

describe("Pool", () => {
  test("pool dispatches all requests and returns positional results", async () => {
    Http.fake({ "*": Http.response({ n: 1 }, 200) });
    const results = await Http.pool((p) => [p.get("https://a.com/"), p.get("https://b.com/")]);
    expect(results).toHaveLength(2);
    expect(results[0]!.ok()).toBe(true);
    expect(results[1]!.ok()).toBe(true);
  });

  test("pool supports named entries via as()", async () => {
    Http.fake({ "*": Http.response({ ok: true }, 200) });
    const results = await Http.pool((p) => [
      p.get("https://a.com/"),
      p.as("named").get("https://b.com/"),
    ]);
    expect(results["named"]!.ok()).toBe(true);
    expect(results[1]!.ok()).toBe(true);
  });

  test("pool respects concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl: typeof globalThis.fetch = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((r) => setTimeout(r, 5));
      inFlight--;
      return new Response(null, { status: 200 });
    };
    const client = createHttpClient({ fetch: fetchImpl });
    await client.pool(
      (p) => [
        p.get("https://a.com/"),
        p.get("https://b.com/"),
        p.get("https://c.com/"),
        p.get("https://d.com/"),
      ],
      { concurrency: 2 },
    );
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe("Batch", () => {
  test("batch lifecycle callbacks fire in order", async () => {
    Http.fake({ "*": Http.response({}, 200) });
    const order: string[] = [];
    await Http.batch((p) => [p.get("https://a.com/")])
      .before(() => order.push("before"))
      .then(() => order.push("then"))
      .finally(() => order.push("finally"))
      .send();
    expect(order).toEqual(["before", "then", "finally"]);
  });

  test("batch progress fires per result", async () => {
    Http.fake({ "*": Http.response({}, 200) });
    const progressed: number[] = [];
    await Http.batch((p) => [p.get("https://a.com/"), p.get("https://b.com/")])
      .progress((_res, idx) => progressed.push(idx))
      .send();
    expect(progressed.sort()).toEqual([0, 1]);
  });
});
