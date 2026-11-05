import { describe, expect, test } from "bun:test";
import * as Type from "../src/vendor/typebox/type/index";
import { Code } from "../src/vendor/typebox/compile/index";

describe("vendored TypeBox Code()", () => {
  test("emits imports that resolve from a consumer project", () => {
    const { Code: source } = Code(Type.Object({ a: Type.String() }));
    const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toStartWith("@kaonashi-dev/techne/typebox/");
    }
  });
});
