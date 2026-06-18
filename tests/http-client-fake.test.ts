import { beforeEach, describe, expect, test } from "bun:test";
import { Http } from "../src/http/factory";
import { fakeReset } from "../src/http/fake";

beforeEach(() => {
  fakeReset();
  Http.resetGlobals();
});

// ─── Http.fake() — empty 200 default ─────────────────────────────────────

describe("Http.fake() — empty 200 default", () => {
  test("all requests return 200 with no body", async () => {
    Http.fake();
    const res = await Http.get("https://example.com/anything");
    expect(res.status()).toBe(200);
    expect(res.body()).toBe("");
  });

  test("records the request", async () => {
    Http.fake();
    await Http.get("https://example.com/user");
    Http.assertSentCount(1);
    Http.assertSent((req) => req.url() === "https://example.com/user");
  });
});

// ─── Http.fake(map) — URL pattern map ─────────────────────────────────────

describe("Http.fake(map)", () => {
  test("matches exact URL pattern and returns Response", async () => {
    Http.fake({ "example.com/users": Http.response({ list: [] }, 200) });
    const res = await Http.get("https://example.com/users");
    expect(res.ok()).toBe(true);
    expect(res.json<{ list: unknown[] }>().list).toEqual([]);
  });

  test("wildcard * matches partial URLs", async () => {
    Http.fake({
      "github.com/*": Http.response({ repo: "techne" }, 200),
      "*": Http.response({ fallback: true }, 200),
    });
    const gh = await Http.get("https://github.com/user/repo");
    expect(gh.json<{ repo: string }>().repo).toBe("techne");

    const other = await Http.get("https://other.com/path");
    expect(other.json<{ fallback: boolean }>().fallback).toBe(true);
  });

  test("number map value → status code with empty body", async () => {
    Http.fake({ "*": 404 });
    const res = await Http.get("https://example.com/");
    expect(res.status()).toBe(404);
    expect(res.body()).toBe("");
  });

  test("string map value → text/plain body", async () => {
    Http.fake({ "*": "Hello world" });
    const res = await Http.get("https://example.com/");
    expect(res.body()).toBe("Hello world");
  });
});

// ─── Http.fake(fn) — closure responder ────────────────────────────────────

describe("Http.fake(fn) — closure responder", () => {
  test("closure receives the request and returns a Response", async () => {
    Http.fake((req) => {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      return new Response(JSON.stringify({ id }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await Http.get("https://example.com/item?id=42");
    expect(res.json<{ id: string }>().id).toBe("42");
  });
});

// ─── Http.sequence() ──────────────────────────────────────────────────────

describe("Http.sequence()", () => {
  test("returns responses in push order", async () => {
    Http.fake({ "*": Http.sequence().push({ n: 1 }, 200).push({ n: 2 }, 200) });
    const r1 = await Http.get("https://example.com/");
    const r2 = await Http.get("https://example.com/");
    expect(r1.json<{ n: number }>().n).toBe(1);
    expect(r2.json<{ n: number }>().n).toBe(2);
  });

  test("pushStatus adds status-only entry", async () => {
    Http.fake({ "*": Http.sequence().pushStatus(404) });
    const res = await Http.get("https://example.com/");
    expect(res.status()).toBe(404);
  });

  test("whenEmpty is used after sequence is exhausted", async () => {
    Http.fake({
      "*": Http.sequence().push({ first: true }, 200).whenEmpty(Http.response(null, 204)),
    });
    await Http.get("https://example.com/");
    const r2 = await Http.get("https://example.com/");
    expect(r2.status()).toBe(204);
  });

  test("throws when exhausted with no whenEmpty", async () => {
    Http.fake({ "*": Http.sequence().pushStatus(200) });
    await Http.get("https://example.com/");
    let threw: unknown;
    try {
      await Http.get("https://example.com/");
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeDefined();
    expect((threw as Error).message).toContain("exhausted");
  });
});

// ─── Http.fakeSequence() ──────────────────────────────────────────────────

describe("Http.fakeSequence()", () => {
  test("applies sequence to all URLs", async () => {
    Http.fakeSequence().push({ a: 1 }, 200).push({ a: 2 }, 200);
    const r1 = await Http.get("https://example.com/one");
    const r2 = await Http.get("https://example.com/two");
    expect(r1.json<{ a: number }>().a).toBe(1);
    expect(r2.json<{ a: number }>().a).toBe(2);
  });
});

// ─── Assertions ───────────────────────────────────────────────────────────

describe("Assertions", () => {
  test("assertSent passes when predicate matches", async () => {
    Http.fake();
    await Http.withToken("tok").get("https://example.com/secure");
    expect(() =>
      Http.assertSent((req) => req.hasHeader("authorization", "Bearer tok")),
    ).not.toThrow();
  });

  test("assertSent throws when predicate does not match", async () => {
    Http.fake();
    await Http.get("https://example.com/");
    expect(() => Http.assertSent((req) => req.url().includes("other"))).toThrow();
  });

  test("assertNotSent passes when predicate does not match", async () => {
    Http.fake();
    await Http.get("https://example.com/");
    expect(() => Http.assertNotSent((req) => req.url().includes("other"))).not.toThrow();
  });

  test("assertNotSent throws when predicate matches", async () => {
    Http.fake();
    await Http.get("https://example.com/");
    expect(() => Http.assertNotSent((req) => req.url().includes("example"))).toThrow();
  });

  test("assertSentCount passes on exact count", async () => {
    Http.fake();
    await Http.get("https://a.com/");
    await Http.get("https://b.com/");
    expect(() => Http.assertSentCount(2)).not.toThrow();
    expect(() => Http.assertSentCount(1)).toThrow();
  });

  test("assertNothingSent passes when no requests made", () => {
    Http.fake();
    expect(() => Http.assertNothingSent()).not.toThrow();
  });

  test("assertNothingSent throws when requests were made", async () => {
    Http.fake();
    await Http.get("https://example.com/");
    expect(() => Http.assertNothingSent()).toThrow();
  });
});

// ─── recorded() filter ────────────────────────────────────────────────────

describe("recorded()", () => {
  test("returns all recorded entries", async () => {
    Http.fake();
    await Http.get("https://a.com/");
    await Http.post("https://b.com/", { x: 1 });
    const entries = Http.recorded();
    expect(entries).toHaveLength(2);
  });

  test("filter reduces result", async () => {
    Http.fake();
    await Http.get("https://a.com/");
    await Http.get("https://b.com/");
    const aEntries = Http.recorded((req) => req.url().includes("a.com"));
    expect(aEntries).toHaveLength(1);
    expect(aEntries[0]!.url()).toContain("a.com");
  });

  test("RecordedRequest exposes method, header, body, data", async () => {
    Http.fake();
    await Http.withToken("tok").post("https://example.com/api", { payload: "value" });
    const entries = Http.recorded();
    const req = entries[0]!;
    expect(req.method()).toBe("POST");
    expect(req.hasHeader("authorization")).toBe(true);
    expect(req.hasHeader("authorization", "Bearer tok")).toBe(true);
    expect(req.data()).toEqual({ payload: "value" });
    expect(req.body()).toContain("payload");
  });
});

// ─── preventStrayRequests ─────────────────────────────────────────────────

describe("preventStrayRequests", () => {
  test("throws on unmatched request when stray prevention is active", async () => {
    Http.fake({ "example.com/*": Http.response({}, 200) });
    Http.preventStrayRequests();
    let threw: unknown;
    try {
      await Http.get("https://other.com/path");
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeDefined();
    expect((threw as Error).message).toContain("Stray request");
  });

  test("allowStrayRequests lets patterns through even when stray prevention is on", async () => {
    Http.fake({});
    Http.preventStrayRequests();
    Http.allowStrayRequests(["https://allowed.com/*"]);

    // Matched → allowed
    // This won't actually hit the network because we don't actually bypass to real fetch in fake mode
    // Instead, this tests that the stray-check doesn't throw for the allowed pattern.
    // The fake store has no match for "allowed.com/*", so it will return empty 200 or throw.
    // The key is the stray check itself doesn't block it.
    // Since there's no match for allowed.com, the fake returns 200 anyway (default).
    let allowed = true;
    try {
      await Http.get("https://allowed.com/path");
    } catch {
      allowed = false;
    }
    // The stray check for allowed.com/* passes, then the URL-map has no match,
    // which for a prevented-stray should still throw unless specifically allowed.
    // Our current impl throws "Stray request" for unmatched in prevent mode.
    // For allowed patterns, we need to return empty 200 (fallback to default).
    // Let's verify allowed doesn't produce a stray error.
    expect(allowed).toBe(true);
  });

  test("unmatched URL throws when preventStray is set", async () => {
    Http.fake({ "exact.com/path": Http.response({}, 200) });
    Http.preventStrayRequests();
    let threw = false;
    try {
      await Http.get("https://different.com/");
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

// ─── Http.response() builder ──────────────────────────────────────────────

describe("Http.response()", () => {
  test("no args → 200 empty response", () => {
    const r = Http.response();
    expect(r.status).toBe(200);
  });

  test("object body → JSON response", () => {
    const r = Http.response({ ok: true }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  test("string body → text response", () => {
    const r = Http.response("hello", 200);
    expect(r.headers.get("content-type")).toContain("text/plain");
  });

  test("number body → status-only response", () => {
    const r = Http.response(503);
    expect(r.status).toBe(503);
  });

  test("custom headers are applied", () => {
    const r = Http.response({ x: 1 }, 200, { "x-custom": "yes" });
    expect(r.headers.get("x-custom")).toBe("yes");
  });
});
