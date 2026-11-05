import { describe, expect, test } from "bun:test";
import { Compile, Compile as compile, t } from "../src/schema/core";
import { isOptionalSchema } from "../src/schema/core/builder";

describe("schema builder", () => {
  test("returns plain JSON Schema objects", () => {
    const schema = t.Object({
      id: t.String({ format: "uuid" }),
      count: t.Integer({ minimum: 1 }),
    });
    expect(schema).toEqual({
      type: "object",
      required: ["id", "count"],
      properties: {
        id: { type: "string", format: "uuid" },
        count: { type: "integer", minimum: 1 },
      },
    });
    expect(JSON.stringify(schema)).not.toContain("~kind");
    expect(JSON.stringify(schema)).not.toContain("~t");
  });

  test("Optional is a non-enumerable marker and removes the key from required", () => {
    const optional = t.Optional(t.String());
    expect(isOptionalSchema(optional)).toBe(true);
    expect(Object.keys(optional)).toEqual(["type"]);
    expect(Object.getOwnPropertySymbols(optional).length).toBe(1);
    expect(JSON.stringify(optional)).toBe('{"type":"string"}');

    const schema = t.Object({ name: t.String(), age: t.Optional(t.Number()) });
    expect(schema.required).toEqual(["name"]);
  });

  test("object transforms preserve or change requiredness", () => {
    const base = t.Object({
      id: t.String(),
      name: t.Optional(t.String()),
      age: t.Number(),
    });
    expect(t.Partial(base).required).toBeUndefined();
    expect(t.Required(base).required).toEqual(["id", "name", "age"]);
    expect(t.Pick(base, ["id", "name"]).required).toEqual(["id"]);
    expect(t.Omit(base, ["age"]).required).toEqual(["id"]);
    expect(t.Readonly(base)).toBe(base);
  });

  test("intersect merges object members at build time", () => {
    const schema = t.Intersect([
      t.Object({ id: t.String() }),
      t.Object({ name: t.String(), age: t.Optional(t.Number()) }),
    ]);
    expect(schema).toEqual({
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        age: { type: "number" },
      },
    });
  });

  test("tuple and record use structural JSON Schema", () => {
    expect(t.Tuple([t.String(), t.Number()])).toEqual({
      type: "array",
      additionalItems: false,
      items: [{ type: "string" }, { type: "number" }],
      minItems: 2,
    });
    expect(t.Record(t.String(), t.Number())).toEqual({
      type: "object",
      patternProperties: { "^.*$": { type: "number" } },
    });
  });
});

describe("schema compiler", () => {
  test("checks primitives and constraints", () => {
    const string = compile(t.String({ minLength: 2, maxLength: 4, pattern: "^[a-z]+$" }));
    expect(string.Check("abc")).toBe(true);
    expect(string.Check("a")).toBe(false);
    expect(string.Check("abcde")).toBe(false);
    expect(string.Check("ABC")).toBe(false);
    expect(string.Check(1)).toBe(false);

    const number = compile(t.Number({ minimum: 1, maximum: 5, multipleOf: 2 }));
    expect(number.Check(2)).toBe(true);
    expect(number.Check(3)).toBe(false);
    expect(number.Check(0)).toBe(false);
    expect(number.Check(6)).toBe(false);
  });

  test("checks objects, required properties and additional properties", () => {
    const open = compile(t.Object({ name: t.String() }));
    expect(open.Check({ name: "Ada", extra: true })).toBe(true);
    expect(open.Check({ name: "Ada" })).toBe(true);
    expect(open.Check({})).toBe(false);

    const closed = compile(t.Object({ name: t.String() }, { additionalProperties: false }));
    expect(closed.Check({ name: "Ada" })).toBe(true);
    expect(closed.Check({ name: "Ada", extra: true })).toBe(false);

    const record = compile(t.Record(t.String(), t.Number()));
    expect(record.Check({ a: 1, b: 2 })).toBe(true);
    expect(record.Check({ a: "1" })).toBe(false);
  });

  test("checks arrays, tuples, unions, literals and never", () => {
    const array = compile(t.Array(t.Number(), { minItems: 1, uniqueItems: true }));
    expect(array.Check([1, 2])).toBe(true);
    expect(array.Check([])).toBe(false);
    expect(array.Check([1, 1])).toBe(false);
    expect(array.Check(1)).toBe(false);

    const tuple = compile(t.Tuple([t.String(), t.Number()]));
    expect(tuple.Check(["a", 1])).toBe(true);
    expect(tuple.Check(["a"])).toBe(false);
    expect(tuple.Check(["a", 1, 2])).toBe(false);

    const union = compile(t.Union([t.Literal("a"), t.Number()]));
    expect(union.Check("a")).toBe(true);
    expect(union.Check(2)).toBe(true);
    expect(union.Check("b")).toBe(false);
    expect(compile(t.Never()).Check(undefined)).toBe(false);
    expect(compile(t.Any()).Check(undefined)).toBe(true);
  });

  test("supports email, uuid, date-time, date and uri formats", () => {
    expect(compile(t.String({ format: "email" })).Check("a@example.com")).toBe(true);
    expect(compile(t.String({ format: "email" })).Check("nope")).toBe(false);
    expect(
      compile(t.String({ format: "uuid" })).Check("550e8400-e29b-41d4-a716-446655440000"),
    ).toBe(true);
    expect(compile(t.String({ format: "uuid" })).Check("nope")).toBe(false);
    expect(compile(t.String({ format: "date-time" })).Check("2020-01-01T00:00:00Z")).toBe(true);
    expect(compile(t.String({ format: "date" })).Check("2020-01-01")).toBe(true);
    expect(compile(t.String({ format: "uri" })).Check("https://example.com/a")).toBe(true);
    expect(compile(t.String({ format: "uri" })).Check("not a uri")).toBe(false);
  });

  test("reports JSON-Schema-shaped issues only after a failed check", () => {
    const validator = compile(
      t.Object({
        name: t.String({ minLength: 2 }),
        age: t.Number(),
      }),
    );
    expect(validator.Check({ name: "Ada", age: 30 })).toBe(true);
    expect(validator.Errors({ name: "Ada", age: 30 })).toEqual([]);

    const issues = validator.Errors({ name: "A" });
    expect(issues.length).toBeGreaterThan(0);
    const required = issues.find((issue) => issue.keyword === "required");
    expect(required).toEqual({
      keyword: "required",
      schemaPath: "#",
      instancePath: "",
      params: { requiredProperties: ["age"] },
      message: "must have required properties age",
    });
    const minLength = issues.find((issue) => issue.keyword === "minLength");
    expect(minLength).toMatchObject({
      keyword: "minLength",
      instancePath: "/name",
      schemaPath: "#/properties/name",
      params: { limit: 2 },
      message: "must not have fewer than 2 characters",
    });
  });

  test("caches compiled validators by schema identity", () => {
    const schema = t.Object({ id: t.String() });
    expect(Compile(schema)).toBe(Compile(schema));
    expect(Compile(schema)).not.toBe(Compile(t.Object({ id: t.String() })));
  });
});

describe("schema coercion", () => {
  test("coerces strings to numbers, integers and booleans", () => {
    expect(compile(t.Number()).Convert("42")).toBe(42);
    expect(compile(t.Integer()).Convert("42.9")).toBe(42);
    expect(compile(t.Boolean()).Convert("true")).toBe(true);
    expect(compile(t.Boolean()).Convert("FALSE")).toBe(false);
    expect(compile(t.Boolean()).Convert("1")).toBe(true);
    expect(compile(t.Boolean()).Convert("0")).toBe(false);
    expect(compile(t.Number()).Convert("not-a-number")).toBe("not-a-number");
  });

  test("coerces nested objects and scalar-to-array", () => {
    const schema = t.Object({
      page: t.Number(),
      tags: t.Array(t.String()),
    });
    expect(compile(schema).Convert({ page: "2", tags: "a" })).toEqual({
      page: 2,
      tags: ["a"],
    });
    expect(compile(t.Array(t.Integer())).Convert("3")).toEqual([3]);
    expect(compile(t.Array(t.Integer())).Convert(["3", "4"])).toEqual([3, 4]);
  });

  test("chooses the union branch that validates", () => {
    const schema = t.Union([t.Number(), t.Boolean()]);
    expect(compile(schema).Convert("true")).toBe(true);
    expect(compile(schema).Convert("12")).toBe(12);
  });
});
