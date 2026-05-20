import { describe, expect, test } from "bun:test";
import { HandlerMetadataStorage } from "../src/core/router/handler-metadata-storage";

describe("HandlerMetadataStorage", () => {
  test("set/get round-trip returns the same object reference", () => {
    const storage = new HandlerMetadataStorage<{ tag: string }>();
    const owner = {};
    const meta = { tag: "alpha" };
    storage.set(owner, "handlerOne", meta);
    const retrieved = storage.get(owner, "handlerOne");
    expect(retrieved).toBe(meta);
    expect(retrieved?.tag).toBe("alpha");
  });

  test("get returns undefined for an unknown owner instance", () => {
    const storage = new HandlerMetadataStorage<{ tag: string }>();
    expect(storage.get({}, "any")).toBeUndefined();
  });

  test("get returns undefined for a known owner but unknown method name", () => {
    const storage = new HandlerMetadataStorage<{ tag: string }>();
    const owner = {};
    storage.set(owner, "known", { tag: "x" });
    expect(storage.get(owner, "unknown")).toBeUndefined();
  });

  test("set on the same (owner, method) overwrites the previous metadata", () => {
    const storage = new HandlerMetadataStorage<{ value: number }>();
    const owner = {};
    storage.set(owner, "m", { value: 1 });
    storage.set(owner, "m", { value: 2 });
    expect(storage.get(owner, "m")).toEqual({ value: 2 });
  });

  test("multiple method names share one inner Map per owner", () => {
    const storage = new HandlerMetadataStorage<{ value: number }>();
    const owner = {};
    storage.set(owner, "a", { value: 1 });
    storage.set(owner, "b", { value: 2 });
    storage.set(owner, "c", { value: 3 });
    expect(storage.get(owner, "a")?.value).toBe(1);
    expect(storage.get(owner, "b")?.value).toBe(2);
    expect(storage.get(owner, "c")?.value).toBe(3);
  });

  test("distinct owner instances keep their entries isolated (WeakMap semantics)", () => {
    const storage = new HandlerMetadataStorage<{ tag: string }>();
    const ownerA = {};
    const ownerB = {};
    storage.set(ownerA, "shared", { tag: "A" });
    storage.set(ownerB, "shared", { tag: "B" });
    expect(storage.get(ownerA, "shared")?.tag).toBe("A");
    expect(storage.get(ownerB, "shared")?.tag).toBe("B");
  });

  test("non-object keys (primitives) throw — the storage is WeakMap-backed", () => {
    const storage = new HandlerMetadataStorage<unknown>();
    // WeakMap rejects primitive keys with a TypeError. This pins the
    // implementation choice: callers must always pass a class/object.
    expect(() => storage.set("primitive" as unknown as object, "m", {})).toThrow();
  });
});
