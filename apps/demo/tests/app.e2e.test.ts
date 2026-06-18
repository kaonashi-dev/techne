import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { TechneFactory } from "../../../src/core/index.ts";
import type { TechneApplication } from "../../../src/core/index.ts";
import { Logger } from "../../../src/common/index.ts";
import { BufferSink, NullSink, Test } from "../../../src/testing/index.ts";
import config from "../techne.config";
import { CqrsStore } from "../src/cqrs/cqrs-store.service";

const BASE = "http://localhost/v1/api";

let app: TechneApplication;

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  return app.handle(new Request(BASE + path, init));
}

beforeAll(async () => {
  app = await TechneFactory.create({ ...config, logger: false });
});

afterAll(async () => {
  await app.close?.();
});

describe("users CRUD + validation", () => {
  test("lists seeded users", async () => {
    const res = await req("GET", "/users");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total: number };
    expect(json.total).toBeGreaterThanOrEqual(2);
  });

  test("404 problem document for missing user", async () => {
    const res = await req("GET", "/users/9999");
    expect(res.status).toBe(404);
  });

  test("creates a valid user", async () => {
    const res = await req("POST", "/users", {
      name: "Grace Hopper",
      email: "grace@example.com",
      role: "editor",
    });
    expect(res.status).toBe(200);
  });

  test("rejects an invalid body with 422", async () => {
    const res = await req("POST", "/users", { name: "x", email: "nope", role: "king" });
    expect(res.status).toBe(422);
  });
});

describe("auth: JWT + roles guard", () => {
  test("admin route is 401 without a token", async () => {
    const res = await req("GET", "/admin/dashboard");
    expect(res.status).toBe(401);
  });

  test("admin token unlocks the dashboard, viewer token is 403", async () => {
    const adminLogin = await req("POST", "/auth/login", { email: "admin@x.com", password: "secret" });
    const { accessToken } = (await adminLogin.json()) as { accessToken: string };
    const ok = await req("GET", "/admin/dashboard", undefined, { authorization: `Bearer ${accessToken}` });
    expect(ok.status).toBe(200);

    const viewerLogin = await req("POST", "/auth/login", { email: "viewer@x.com", password: "secret" });
    const viewerToken = ((await viewerLogin.json()) as { accessToken: string }).accessToken;
    const forbidden = await req("GET", "/admin/dashboard", undefined, {
      authorization: `Bearer ${viewerToken}`,
    });
    expect(forbidden.status).toBe(403);
  });
});

describe("CQRS + MQ + guards + filters", () => {
  test("command/query buses round-trip a user", async () => {
    const created = await req("POST", "/cqrs/users", { name: "Eve", email: "eve@example.com" });
    expect(created.status).toBe(200);
    const list = await req("GET", "/cqrs/users");
    const users = (await list.json()) as Array<{ email: string }>;
    expect(users.some((u) => u.email === "eve@example.com")).toBe(true);
  });

  test("queue rejects an invalid payload (422) and accepts a valid one", async () => {
    const bad = await req("POST", "/mq/emails", { to: "not-an-email" });
    expect(bad.status).toBe(422);
    const ok = await req("POST", "/mq/emails", { to: "a@b.com", subject: "hi" });
    expect(ok.status).toBe(200);
  });

  test("api-key guard blocks then allows the status route", async () => {
    expect((await req("GET", "/status")).status).toBe(403);
    const ok = await req("GET", "/status", undefined, { "x-api-key": "demo-api-key-1234567890" });
    expect(ok.status).toBe(200);
  });

  test("scoped exception filter maps a domain error to 422", async () => {
    const res = await req("GET", "/status/boom", undefined, { "x-api-key": "demo-api-key-1234567890" });
    expect(res.status).toBe(422);
    expect((await res.json()) as { error: string }).toMatchObject({ error: "domain_rule_violation" });
  });

  test("single-action controller responds", async () => {
    const res = await req("GET", "/reports/42");
    expect(res.status).toBe(200);
    expect((await res.json()) as { id: string }).toMatchObject({ id: "42" });
  });
});

describe("testing utilities", () => {
  test("Test.createTestingModule resolves a provider", async () => {
    const moduleRef = await Test.createTestingModule({ providers: [CqrsStore] }).compile();
    const store = moduleRef.get<CqrsStore>(CqrsStore);
    const user = store.add("Tester", "tester@example.com");
    expect(user.id).toBeGreaterThan(0);
    expect(store.list()).toHaveLength(1);
  });

  test("BufferSink captures structured logs", () => {
    const previous = Logger.getSink();
    const sink = new BufferSink();
    Logger.setEnabled(true);
    Logger.setSink(sink);
    try {
      new Logger("Spec").log("hello world");
      expect(sink.lines.join("\n")).toContain("hello world");
    } finally {
      Logger.setSink(previous);
      Logger.setEnabled(false);
    }
  });

  test("NullSink silences output", () => {
    const previous = Logger.getSink();
    Logger.setSink(new NullSink());
    try {
      expect(() => new Logger("Spec").log("silent")).not.toThrow();
    } finally {
      Logger.setSink(previous);
    }
  });
});
