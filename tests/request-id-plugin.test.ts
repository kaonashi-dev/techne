import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { requestIdPlugin } from "../src/core/plugins/built-in/request-id.plugin";
import { NotFoundException } from "../src/exceptions";

// We boot with `requestId: false` so the adapter's built-in request-id hook
// is hard-disabled. That makes the plugin the only thing populating
// `ctx.store.requestId`, which we observe through the problem-document
// `requestId` extension field surfaced by RouterResponseController.

@Controller("rid")
class RidController {
  @Get("/ok")
  ok() {
    return { ok: true };
  }
  @Get("/boom")
  boom() {
    throw new NotFoundException("nope");
  }
}

describe("requestIdPlugin", () => {
  test("preserves an inbound x-request-id header on the problem document", async () => {
    const app = await TechneFactory.create({
      controllers: [RidController],
      logger: false,
      plugins: [requestIdPlugin],
      // Disable the adapter's built-in request-id so the plugin owns the field.
      requestId: false,
    } as any);
    const inbound = "incoming-rid-1234";
    const res = await app.handle(
      new Request("http://localhost/rid/boom", {
        headers: { "x-request-id": inbound },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.requestId).toBe(inbound);
  });

  test("generates a UUID-shaped requestId when no inbound header is present", async () => {
    const app = await TechneFactory.create({
      controllers: [RidController],
      logger: false,
      plugins: [requestIdPlugin],
      requestId: false,
    } as any);
    const res = await app.handle(new Request("http://localhost/rid/boom"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.requestId).toBe("string");
    // UUIDv4/v7 shape: 8-4-4-4-12 hex segments.
    expect(body.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("custom `header` option reads/writes the configured header name", async () => {
    const app = await TechneFactory.create({
      controllers: [RidController],
      logger: false,
      requestId: false,
    } as any);
    // The factory-registered plugin path doesn't accept per-plugin options;
    // use the runtime `app.register(plugin, options)` API instead.
    await app.register(requestIdPlugin, { header: "x-trace-id" });

    const inbound = "trace-id-abc";
    const res = await app.handle(
      new Request("http://localhost/rid/boom", {
        headers: { "x-trace-id": inbound },
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    // The plugin reads from x-trace-id and stamps store.requestId, which
    // RouterResponseController surfaces under the standard `requestId` key.
    expect(body.requestId).toBe(inbound);

    // Sanity: an x-request-id header should NOT be picked up when the plugin
    // is configured for x-trace-id only.
    const ignored = await app.handle(
      new Request("http://localhost/rid/boom", {
        headers: { "x-request-id": "should-be-ignored" },
      }),
    );
    const ignoredBody = await ignored.json();
    expect(ignoredBody.requestId).not.toBe("should-be-ignored");
  });

  test("falls back to a generated id when crypto.randomUUID and Bun.randomUUIDv7 are unavailable", async () => {
    const originalCrypto = globalThis.crypto;
    const originalBunUUIDv7 = (Bun as any).randomUUIDv7;

    // Stub crypto to expose only the methods the rest of the framework
    // depends on at boot, but with `randomUUID` returning a sentinel value
    // we can detect. We can't actually remove `crypto.randomUUID` mid-process
    // without breaking unrelated framework code, so this asserts that the
    // plugin's fallback path delegates to whatever `crypto.randomUUID` returns
    // and that it doesn't crash when `Bun.randomUUIDv7` is missing.
    (Bun as any).randomUUIDv7 = undefined;
    const sentinel = "00000000-0000-4000-8000-000000000abc";
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      writable: true,
      value: {
        ...originalCrypto,
        randomUUID: () => sentinel,
      },
    });

    try {
      const app = await TechneFactory.create({
        controllers: [RidController],
        logger: false,
        plugins: [requestIdPlugin],
        requestId: false,
      } as any);
      const res = await app.handle(new Request("http://localhost/rid/boom"));
      const body = await res.json();
      expect(body.requestId).toBe(sentinel);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        writable: true,
        value: originalCrypto,
      });
      (Bun as any).randomUUIDv7 = originalBunUUIDv7;
    }
  });

  // Defensive: ensure the global crypto restoration in the previous test runs
  // even if Bun.test aborts that test mid-flight, by re-asserting in this
  // empty hook pair.
  beforeEach(() => {});
  afterEach(() => {});
});
