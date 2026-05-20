import { test, expect, describe } from "bun:test";
import "../src/reflect-setup";
import { Reflector } from "../src/core/reflector";

describe("Reflector", () => {
  describe("get()", () => {
    test("returns metadata defined on a class target", () => {
      const KEY = "test:roles";
      class Controller {}
      Reflect.defineMetadata(KEY, ["admin"], Controller);

      const reflector = new Reflector();
      expect(reflector.get<string[]>(KEY, Controller)).toEqual(["admin"]);
    });

    test("returns metadata defined on a method target", () => {
      const KEY = "test:roles";
      class Controller {
        handler() {}
      }
      Reflect.defineMetadata(KEY, ["user"], Controller.prototype.handler);

      const reflector = new Reflector();
      expect(reflector.get<string[]>(KEY, Controller.prototype.handler)).toEqual(["user"]);
    });

    test("returns undefined when metadata is missing", () => {
      class Controller {}
      const reflector = new Reflector();
      expect(reflector.get<string[]>("missing:key", Controller)).toBeUndefined();
    });
  });

  describe("getAll()", () => {
    test("returns metadata from each target as an array, in order", () => {
      const KEY = "test:tag";
      class A {}
      class B {}
      Reflect.defineMetadata(KEY, "a-tag", A);
      Reflect.defineMetadata(KEY, "b-tag", B);

      const reflector = new Reflector();
      const result = reflector.getAll<string[]>(KEY, [A, B]);
      expect(result).toEqual(["a-tag", "b-tag"]);
    });

    test("returns undefined entries for targets without metadata", () => {
      const KEY = "test:tag";
      class A {}
      class B {}
      Reflect.defineMetadata(KEY, "a-tag", A);

      const reflector = new Reflector();
      const result = reflector.getAll<any[]>(KEY, [A, B]);
      expect(result).toEqual(["a-tag", undefined]);
    });

    test("returns an empty array when targets list is empty", () => {
      const reflector = new Reflector();
      expect(reflector.getAll("any:key", [])).toEqual([]);
    });
  });

  describe("getAllAndOverride()", () => {
    test("returns the first defined value (handler overrides class)", () => {
      const KEY = "test:roles";
      class Controller {
        handler() {}
      }
      // Stack two decorators using raw Reflect calls so the test does not
      // depend on framework decorators.
      Reflect.defineMetadata(KEY, ["class-role"], Controller);
      Reflect.defineMetadata(KEY, ["handler-role"], Controller.prototype.handler);

      const reflector = new Reflector();
      const result = reflector.getAllAndOverride<string[]>(KEY, [
        Controller.prototype.handler,
        Controller,
      ]);
      expect(result).toEqual(["handler-role"]);
    });

    test("falls through to class-level metadata when handler has none", () => {
      const KEY = "test:roles";
      class Controller {
        handler() {}
      }
      Reflect.defineMetadata(KEY, ["class-only"], Controller);

      const reflector = new Reflector();
      const result = reflector.getAllAndOverride<string[]>(KEY, [
        Controller.prototype.handler,
        Controller,
      ]);
      expect(result).toEqual(["class-only"]);
    });

    test("returns undefined when no target has metadata", () => {
      class Controller {
        handler() {}
      }
      const reflector = new Reflector();
      const result = reflector.getAllAndOverride<string[]>("missing:key", [
        Controller.prototype.handler,
        Controller,
      ]);
      expect(result).toBeUndefined();
    });
  });

  describe("getAllAndMerge()", () => {
    test("concatenates arrays from all targets and de-duplicates by strict equality", () => {
      const KEY = "test:roles";
      class Controller {
        handler() {}
      }
      Reflect.defineMetadata(KEY, ["admin", "shared"], Controller);
      Reflect.defineMetadata(KEY, ["user", "shared"], Controller.prototype.handler);

      const reflector = new Reflector();
      const merged = reflector.getAllAndMerge<string[]>(KEY, [
        Controller.prototype.handler,
        Controller,
      ]);
      // Iteration starts with the handler value, then merges the class value.
      expect(merged).toContain("admin");
      expect(merged).toContain("user");
      expect(merged).toContain("shared");
      // Strict-equality dedupe: "shared" should appear exactly once.
      expect(merged.filter((r) => r === "shared")).toHaveLength(1);
    });

    test("shallow-merges objects with last-write-wins semantics", () => {
      const KEY = "test:options";
      class Controller {
        handler() {}
      }
      Reflect.defineMetadata(KEY, { cache: true, ttl: 60 }, Controller.prototype.handler);
      Reflect.defineMetadata(KEY, { ttl: 30, retries: 3 }, Controller);

      const reflector = new Reflector();
      const merged = reflector.getAllAndMerge<Record<string, unknown>>(KEY, [
        Controller.prototype.handler,
        Controller,
      ]);
      expect(merged).toEqual({ cache: true, ttl: 30, retries: 3 });
    });

    test("returns undefined when no target has metadata", () => {
      class A {}
      const reflector = new Reflector();
      expect(reflector.getAllAndMerge("missing:key", [A])).toBeUndefined();
    });

    test("returns the first defined scalar value", () => {
      const KEY = "test:scalar";
      class A {}
      class B {}
      Reflect.defineMetadata(KEY, "first", A);
      Reflect.defineMetadata(KEY, "second", B);

      const reflector = new Reflector();
      expect(reflector.getAllAndMerge<string>(KEY, [A, B])).toBe("first");
    });
  });
});
