import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { compileStringifier } from "../src/schema/fast-stringify";
function expectEqualsJson(schemaFn: () => any, value: unknown) {
    const stringify = compileStringifier(schemaFn());
    const out = stringify(value);
    // Semantically identical: both should parse back to the same shape.
    expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(value)));
}
describe("compileStringifier", () => {
    test("flat object with strings and numbers", () => {
        const schema = Type.Object({
            id: Type.Number(),
            name: Type.String(),
        });
        const stringify = compileStringifier(schema);
        const out = stringify({ id: 1, name: "Alice" });
        expect(JSON.parse(out)).toEqual({ id: 1, name: "Alice" });
    });
    test("matches JSON.stringify output for object with mixed primitives", () => {
        const schema = Type.Object({
            id: Type.Integer(),
            name: Type.String(),
            active: Type.Boolean(),
        });
        const value = { id: 42, name: "Bob", active: true };
        const stringify = compileStringifier(schema);
        expect(JSON.parse(stringify(value))).toEqual(value);
    });
    test("optional property is omitted when undefined", () => {
        const schema = Type.Object({
            name: Type.String(),
            age: Type.Optional(Type.Number()),
        });
        const stringify = compileStringifier(schema);
        const out1 = stringify({ name: "x" });
        expect(JSON.parse(out1)).toEqual({ name: "x" });
        expect(out1.includes("age")).toBe(false);
        const out2 = stringify({ name: "x", age: 7 });
        expect(JSON.parse(out2)).toEqual({ name: "x", age: 7 });
    });
    test("array of objects", () => {
        const schema = Type.Array(Type.Object({
            id: Type.Number(),
            name: Type.String(),
        }));
        const value = [
            { id: 1, name: "A" },
            { id: 2, name: "B" },
        ];
        const stringify = compileStringifier(schema);
        expect(JSON.parse(stringify(value))).toEqual(value);
    });
    test("nested object", () => {
        const schema = Type.Object({
            user: Type.Object({
                id: Type.Number(),
                meta: Type.Object({
                    score: Type.Number(),
                }),
            }),
        });
        const value = { user: { id: 1, meta: { score: 99 } } };
        const stringify = compileStringifier(schema);
        expect(JSON.parse(stringify(value))).toEqual(value);
    });
    test("empty array and empty object", () => {
        const arrSchema = Type.Array(Type.Number());
        expect(compileStringifier(arrSchema)([])).toBe("[]");
        const objSchema = Type.Object({});
        expect(compileStringifier(objSchema)({})).toBe("{}");
    });
    test("falls back for unsupported schema (Union)", () => {
        const schema = Type.Union([Type.String(), Type.Number()]);
        const stringify = compileStringifier(schema);
        expect(stringify("hello")).toBe('"hello"');
        expect(stringify(42)).toBe("42");
    });
    test("string with special characters round-trips", () => {
        const schema = Type.Object({ s: Type.String() });
        const stringify = compileStringifier(schema);
        const value = { s: 'with "quotes"\nand\tnewlines' };
        expect(JSON.parse(stringify(value))).toEqual(value);
    });
    test("compiles deterministically by schema reference (cache)", () => {
        const schema = Type.Object({ x: Type.Number() });
        const a = compileStringifier(schema);
        const b = compileStringifier(schema);
        expect(a).toBe(b);
    });
    test("matches JSON.stringify semantically for several shapes", () => {
        expectEqualsJson(() => Type.Object({ a: Type.Number(), b: Type.String() }), { a: 1, b: "x" });
        expectEqualsJson(() => Type.Array(Type.Object({ id: Type.Number() })), [{ id: 1 }, { id: 2 }, { id: 3 }]);
        expectEqualsJson(() => Type.Object({ ok: Type.Boolean() }), { ok: false });
    });
});
