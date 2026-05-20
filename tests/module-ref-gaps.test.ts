import { test, expect, describe } from "bun:test";
import { Test } from "../src/testing";
import { Injectable } from "../src/decorators/injectable.decorator";
import { ModuleRef } from "../src/core/module-ref";
import { Scope } from "../src/core/scope";

describe("ModuleRef gaps", () => {
  test("createContextId() returns a unique opaque id on each call", async () => {
    const module = await Test.createTestingModule({ providers: [] }).compile();
    const moduleRef = module.get<ModuleRef>(ModuleRef);

    const id1 = moduleRef.createContextId();
    const id2 = moduleRef.createContextId();
    const id3 = moduleRef.createContextId();

    expect(typeof id1).toBe("symbol");
    expect(typeof id2).toBe("symbol");
    expect(typeof id3).toBe("symbol");
    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  test("resolve(token) returns a fresh instance for transient providers", async () => {
    @Injectable({ scope: Scope.TRANSIENT })
    class TransientService {
      readonly id = Math.random();
    }

    const module = await Test.createTestingModule({
      providers: [TransientService],
    }).compile();
    const moduleRef = module.get<ModuleRef>(ModuleRef);

    const a = moduleRef.resolve<TransientService>(TransientService);
    const b = moduleRef.resolve<TransientService>(TransientService);

    expect(a).toBeInstanceOf(TransientService);
    expect(b).toBeInstanceOf(TransientService);
    expect(a).not.toBe(b);
  });

  test("resolve(token, { contextId }) returns the same instance for the same context id", async () => {
    @Injectable({ scope: Scope.REQUEST })
    class RequestScopedService {
      readonly id = Math.random();
    }

    const module = await Test.createTestingModule({
      providers: [RequestScopedService],
    }).compile();
    const moduleRef = module.get<ModuleRef>(ModuleRef);

    const ctxA = moduleRef.createContextId();
    const ctxB = moduleRef.createContextId();

    const a1 = moduleRef.resolve<RequestScopedService>(RequestScopedService, { contextId: ctxA });
    const a2 = moduleRef.resolve<RequestScopedService>(RequestScopedService, { contextId: ctxA });
    const b1 = moduleRef.resolve<RequestScopedService>(RequestScopedService, { contextId: ctxB });

    // Same context: same instance.
    expect(a1).toBe(a2);
    // Different context: different instance.
    expect(a1).not.toBe(b1);
  });

  test("resolving an unregistered non-class token throws a clear error", async () => {
    const module = await Test.createTestingModule({ providers: [] }).compile();
    const moduleRef = module.get<ModuleRef>(ModuleRef);
    const MISSING = Symbol("MISSING_TOKEN");

    let caught: unknown;
    try {
      moduleRef.resolve(MISSING);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // Source throws: "Cannot resolve token: ... No provider registered and it's not a class."
    expect(message).toContain("Cannot resolve token");
    expect(message).toContain("No provider registered");
    expect(message).toContain(String(MISSING));
  });
});
