import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { Schema } from "../src/schema";
import {
  ClientError,
  createClient,
  generateRoutesType,
  typeboxToTypeScript,
  type RouteHandler,
} from "../src/contract";

interface MockCall {
  url: string;
  init: RequestInit;
}

function makeFetch(responder: (call: MockCall) => Response | Promise<Response>) {
  const calls: MockCall[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const call: MockCall = { url, init: init ?? {} };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

type DemoRoutes = {
  "/users/:id": {
    get: RouteHandler<undefined, undefined, { id: string }, { id: string; name: string }>;
  };
  "/users": {
    get: RouteHandler<
      undefined,
      { tag?: string[]; page?: string },
      undefined,
      Array<{ id: string }>
    >;
    post: RouteHandler<{ name: string }, undefined, undefined, { id: string; name: string }>;
  };
  "/things/:id": {
    delete: RouteHandler<undefined, undefined, { id: string }, undefined>;
  };
};

describe("contract / createClient", () => {
  test("substitutes :params and issues GET with no body", async () => {
    const { fetchImpl, calls } = makeFetch(
      () =>
        new Response(JSON.stringify({ id: "42", name: "Alice" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createClient<DemoRoutes>({
      baseUrl: "http://localhost:3000",
      fetch: fetchImpl,
    });

    const user = await api["/users/:id"].get({ params: { id: "42" } });
    expect(user).toEqual({ id: "42", name: "Alice" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://localhost:3000/users/42");
    expect((calls[0]!.init.method ?? "").toUpperCase()).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
  });

  test("POST stringifies body and sets application/json content-type", async () => {
    const { fetchImpl, calls } = makeFetch(
      () =>
        new Response(JSON.stringify({ id: "u1", name: "Alice" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createClient<DemoRoutes>({
      baseUrl: "http://localhost:3000/",
      fetch: fetchImpl,
    });

    const created = await api["/users"].post({ body: { name: "Alice" } });
    expect(created).toEqual({ id: "u1", name: "Alice" });
    expect(calls[0]!.url).toBe("http://localhost:3000/users");
    expect((calls[0]!.init.method ?? "").toUpperCase()).toBe("POST");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ name: "Alice" }));

    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get("content-type")).toBe("application/json");
  });

  test("non-2xx with problem+json throws ClientError carrying the parsed problem", async () => {
    const problem = {
      type: "https://github.com/kaonashi-dev/techne/blob/main/docs/errors/not-found.md",
      title: "Not Found",
      status: 404,
      detail: "User u404 does not exist",
      code: "USER_NOT_FOUND",
    };
    const { fetchImpl } = makeFetch(
      () =>
        new Response(JSON.stringify(problem), {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        }),
    );
    let captured: ClientError | undefined;
    const api = createClient<DemoRoutes>({
      baseUrl: "http://localhost:3000",
      fetch: fetchImpl,
      onError: (err) => {
        captured = err;
      },
    });

    let thrown: unknown;
    try {
      await api["/users/:id"].get({ params: { id: "u404" } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ClientError);
    expect((thrown as ClientError).status).toBe(404);
    expect((thrown as ClientError).problem).toEqual(problem);
    expect((thrown as ClientError).message).toBe("Not Found");
    expect(captured).toBe(thrown as ClientError);
  });

  test("encodes object query params, including array values as repeated keys", async () => {
    const { fetchImpl, calls } = makeFetch(
      () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const api = createClient<DemoRoutes>({
      baseUrl: "http://localhost:3000",
      fetch: fetchImpl,
    });

    await api["/users"].get({ query: { tag: ["a", "b"], page: "2" } });
    expect(calls[0]!.url).toContain("?");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/users");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b"]);
    expect(url.searchParams.get("page")).toBe("2");
  });

  test("DELETE without body returns undefined on 204", async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 204 }));
    const api = createClient<DemoRoutes>({
      baseUrl: "http://localhost:3000",
      fetch: fetchImpl,
    });
    const result = await api["/things/:id"].delete({ params: { id: "thing-1" } });
    expect(result).toBeUndefined();
    expect((calls[0]!.init.method ?? "").toUpperCase()).toBe("DELETE");
    expect(calls[0]!.url).toBe("http://localhost:3000/things/thing-1");
  });
});

describe("contract / typeboxToTypeScript", () => {
  test("emits object types with optional markers", () => {
    const out = typeboxToTypeScript(
      Schema.Object({
        id: Schema.String(),
        nickname: Schema.Optional(Schema.String()),
        count: Schema.Number(),
      }),
    );
    expect(out).toContain("id: string");
    expect(out).toContain("nickname?: string");
    expect(out).toContain("count: number");
  });

  test("emits unions, literals, and arrays", () => {
    expect(typeboxToTypeScript(Schema.Union([Schema.String(), Schema.Number()]))).toBe(
      "string | number",
    );
    expect(typeboxToTypeScript(Schema.Literal("draft"))).toBe(`"draft"`);
    expect(typeboxToTypeScript(Schema.Array(Schema.String()))).toBe("string[]");
    expect(typeboxToTypeScript(Schema.Any())).toBe("unknown");
    expect(typeboxToTypeScript(Schema.Boolean())).toBe("boolean");
  });
});

describe("contract / generateRoutesType", () => {
  test("produces a Routes type literal for GET + POST routes", async () => {
    @Controller("users")
    class UsersController {
      @Get("/:id", {
        params: Schema.Object({ id: Schema.String() }),
        response: Schema.Object({ id: Schema.String(), name: Schema.String() }),
      })
      findOne() {
        return null;
      }

      @Post("/", {
        body: Schema.Object({
          name: Schema.String({ minLength: 1 }),
          tags: Schema.Optional(Schema.Array(Schema.String())),
        }),
      })
      create() {
        return null;
      }
    }

    @Module({ controllers: [UsersController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, { logger: false });
    const source = generateRoutesType(app);

    // File preamble and re-export hook.
    expect(source).toContain(`import type { RouteHandler } from "@kaonashi-dev/techne/contract"`);
    expect(source).toContain("export type Routes = {");

    // Both routes are present, keyed by their full path.
    expect(source).toContain(`"/users/:id"`);
    expect(source).toContain(`"/users"`);

    // GET picked up the response shape from TypeBox.
    expect(source).toMatch(
      /get: RouteHandler<undefined, undefined, \{ id: string \}, \{ id: string; name: string \}>/,
    );

    // POST picked up the body — including the optional tags array.
    expect(source).toMatch(
      /post: RouteHandler<\{ name: string; tags\?: string\[\] \}, undefined, undefined, unknown>/,
    );

    await app.close();
  });

  test("infers path-param shape from `:segment` when no schema is declared", async () => {
    @Controller("orders")
    class OrdersController {
      @Get("/:orderId/items/:itemId")
      findItem() {
        return null;
      }
    }

    @Module({ controllers: [OrdersController] })
    class AppModule {}

    const app = await TechneFactory.create(AppModule, { logger: false });
    const source = generateRoutesType(app);

    expect(source).toContain(`"/orders/:orderId/items/:itemId"`);
    expect(source).toMatch(
      /get: RouteHandler<undefined, undefined, \{ orderId: string; itemId: string \}, unknown>/,
    );

    await app.close();
  });
});
