import {
  OptionalSymbol,
  type ArrayOptions,
  type NumberOptions,
  type ObjectOptions,
  type SchemaOptions,
  type StaticProperties,
  type StringOptions,
  type Static,
  type TAny,
  type TArray,
  type TBoolean,
  type TInteger,
  type TIntersect,
  type TLiteral,
  type TNever,
  type TNull,
  type TNumber,
  type TObject,
  type TOptional,
  type TProperties,
  type TReadonly,
  type TRecord,
  type TSchema,
  type TString,
  type TTuple,
  type TUnion,
} from "./types";

const ObjectCtor = globalThis.Object;
const ArrayCtor = globalThis.Array;
const StringCtor = globalThis.String;

/** True when a schema was passed through {@link Optional}. */
export function isOptionalSchema(schema: unknown): boolean {
  return (
    schema !== null &&
    typeof schema === "object" &&
    (schema as { readonly [OptionalSymbol]?: unknown })[OptionalSymbol] === true
  );
}

function markOptional<T extends TSchema>(schema: T): TOptional<T> {
  if (!isOptionalSchema(schema)) {
    ObjectCtor.defineProperty(schema, OptionalSymbol, {
      value: true,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }
  return schema as TOptional<T>;
}

function cloneWithoutOptional<T extends TSchema>(schema: T): T {
  const clone = { ...schema } as Record<PropertyKey, unknown>;
  delete clone[OptionalSymbol];
  return clone as T;
}

function requiredKeys(properties: TProperties): string[] {
  const keys = ObjectCtor.keys(properties);
  const required: string[] = [];
  for (const key of keys) {
    if (!isOptionalSchema(properties[key])) required.push(key);
  }
  return required;
}

function objectSchema<P extends TProperties>(
  properties: P,
  required: readonly string[],
  options: ObjectOptions,
): TObject<P> {
  return {
    type: "object",
    ...(required.length > 0 ? { required } : {}),
    properties,
    ...options,
  } as TObject<P>;
}

// ─── Primitive builders ──────────────────────────────────────────────────────

export function String(options: StringOptions = {}): TString {
  return { type: "string", ...options };
}

export function Number(options: NumberOptions = {}): TNumber {
  return { type: "number", ...options };
}

export function Integer(options: NumberOptions = {}): TInteger {
  return { type: "integer", ...options };
}

export function Boolean(options: SchemaOptions = {}): TBoolean {
  return { type: "boolean", ...options };
}

export function Null(options: SchemaOptions = {}): TNull {
  return { type: "null", ...options };
}

export function Any(options: SchemaOptions = {}): TAny {
  return { ...options };
}

export function Unknown(options: SchemaOptions = {}): TAny {
  return { ...options };
}

export function Never(options: SchemaOptions = {}): TNever {
  return { not: {}, ...options } as unknown as TNever;
}

export function Literal<const V extends string | number | boolean | null>(
  value: V,
  options: SchemaOptions = {},
): TLiteral<V> {
  const type =
    value === null
      ? "null"
      : typeof value === "number"
        ? "number"
        : typeof value === "boolean"
          ? "boolean"
          : "string";
  return { type, const: value, ...options } as TLiteral<V>;
}

// ─── Containers ──────────────────────────────────────────────────────────────

export function Array<const T extends TSchema>(items: T, options: ArrayOptions = {}): TArray<T> {
  return { type: "array", items, ...options };
}

export function Tuple<const T extends readonly TSchema[]>(
  items: T,
  options: ArrayOptions = {},
): TTuple<T> {
  return {
    type: "array",
    additionalItems: false,
    items,
    minItems: items.length,
    ...options,
  } as TTuple<T>;
}

export function Object<const P extends TProperties>(
  properties: P,
  options: ObjectOptions = {},
): TObject<P> {
  return objectSchema(properties, requiredKeys(properties), options);
}

export function Union<const T extends readonly TSchema[]>(
  anyOf: T,
  options: SchemaOptions = {},
): TUnion<T> {
  return { anyOf, ...options } as TUnion<T>;
}

export function Optional<T extends TSchema>(schema: T): TOptional<T> {
  return markOptional(schema);
}

export function Readonly<T extends TSchema>(schema: T): TReadonly<T> {
  return schema as unknown as TReadonly<T>;
}

export function Record<K extends TSchema, V extends TSchema>(
  key: K,
  value: V,
  options: ObjectOptions = {},
): TRecord<K, V> {
  const keys = literalKeys(key);
  if (keys !== undefined) {
    const properties: Record<string, V> = {};
    for (const name of keys) properties[name] = value;
    return objectSchema(properties, keys, options) as TRecord<K, V>;
  }
  return {
    type: "object",
    patternProperties: { [patternFor(key)]: value },
    ...options,
  } as TRecord<K, V>;
}

function literalKeys(schema: TSchema): string[] | undefined {
  if ("const" in schema) return [StringCtor(schema.const)];
  const members = ArrayCtor.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (!members) return undefined;
  const keys: string[] = [];
  for (const member of members) {
    const nested = literalKeys(member as TSchema);
    if (!nested) return undefined;
    keys.push(...nested);
  }
  return keys;
}

const INTEGER_PATTERN = "^-?(?:0|[1-9][0-9]*)$";
const NUMBER_PATTERN = "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$";

function patternFor(key: TSchema): string {
  if (key.type === "integer") return INTEGER_PATTERN;
  if (key.type === "number") return NUMBER_PATTERN;
  return "^.*$";
}

// ─── Object transforms ───────────────────────────────────────────────────────

type PartialProperties<P extends TProperties> = {
  [K in keyof P]: P[K] extends { readonly [OptionalSymbol]: true }
    ? P[K]
    : P[K] & { readonly [OptionalSymbol]: true };
};

type RequiredProperties<P extends TProperties> = {
  [K in keyof P]: P[K] extends { readonly [OptionalSymbol]: true }
    ? Omit<P[K], typeof OptionalSymbol>
    : P[K];
};

export function Partial<const P extends TProperties>(
  schema: TObject<P>,
  options: ObjectOptions = {},
): TObject<PartialProperties<P>> {
  const properties: Record<string, TSchema> = {};
  for (const key of ObjectCtor.keys(schema.properties)) {
    const property = schema.properties[key]!;
    properties[key] = isOptionalSchema(property)
      ? property
      : markOptional({ ...property } as TSchema);
  }
  return objectSchema(properties as PartialProperties<P>, [], options);
}

export function Required<const P extends TProperties>(
  schema: TObject<P>,
  options: ObjectOptions = {},
): TObject<RequiredProperties<P>, { -readonly [K in keyof P]-?: Static<P[K]> }> {
  const properties: Record<string, TSchema> = {};
  for (const key of ObjectCtor.keys(schema.properties)) {
    const property = schema.properties[key]!;
    properties[key] = isOptionalSchema(property) ? cloneWithoutOptional(property) : property;
  }
  return objectSchema(
    properties as RequiredProperties<P>,
    ObjectCtor.keys(properties),
    options,
  ) as TObject<RequiredProperties<P>, { -readonly [K in keyof P]-?: Static<P[K]> }>;
}

export function Pick<const P extends TProperties, const K extends keyof P>(
  schema: TObject<P>,
  keys: readonly K[],
  options: ObjectOptions = {},
): TObject<Pick<P, K>> {
  const properties: Record<string, TSchema> = {};
  const required: string[] = [];
  const kept = new Set<PropertyKey>(keys);
  const declared = new Set(schema.required ?? requiredKeys(schema.properties));
  for (const key of ObjectCtor.keys(schema.properties)) {
    if (!kept.has(key)) continue;
    properties[key] = schema.properties[key]!;
    if (declared.has(key)) required.push(key);
  }
  return objectSchema(properties as Pick<P, K>, required, options);
}

export function Omit<const P extends TProperties, const K extends keyof P>(
  schema: TObject<P>,
  keys: readonly K[],
  options: ObjectOptions = {},
): TObject<Omit<P, K>> {
  const properties: Record<string, TSchema> = {};
  const required: string[] = [];
  const omitted = new Set<PropertyKey>(keys);
  const declared = new Set(schema.required ?? requiredKeys(schema.properties));
  for (const key of ObjectCtor.keys(schema.properties)) {
    if (omitted.has(key)) continue;
    properties[key] = schema.properties[key]!;
    if (declared.has(key)) required.push(key);
  }
  return objectSchema(properties as Omit<P, K>, required, options);
}

/**
 * Merges object intersections at build time. Non-object intersections stay as
 * JSON Schema `allOf` so consumers that walk the schema see valid JSON Schema.
 */
export function Intersect<const T extends readonly TSchema[]>(
  allOf: T,
  options: SchemaOptions = {},
): TIntersect<T> {
  if (allOf.length > 0 && allOf.every(isObjectSchema)) {
    const properties: Record<string, TSchema> = {};
    const required = new Set<string>();
    const mergedOptions: SchemaOptions = {};
    for (const member of allOf) {
      for (const key of ObjectCtor.keys(member)) {
        if (
          key !== "type" &&
          key !== "properties" &&
          key !== "required" &&
          key !== "additionalProperties"
        ) {
          mergedOptions[key] = member[key];
        }
      }
      if (member.additionalProperties !== undefined) {
        mergedOptions.additionalProperties = member.additionalProperties;
      }
      for (const key of ObjectCtor.keys(member.properties)) {
        properties[key] = member.properties[key]!;
      }
      const memberRequired = member.required ?? requiredKeys(member.properties as TProperties);
      for (const key of memberRequired) required.add(key);
    }
    for (const key of required) {
      const property = properties[key];
      if (property && isOptionalSchema(property)) {
        properties[key] = cloneWithoutOptional(property);
      }
    }
    const merged = objectSchema(properties, [...required], {
      ...mergedOptions,
      ...options,
    } as ObjectOptions);
    return merged as unknown as TIntersect<T>;
  }
  return { allOf, ...options } as TIntersect<T>;
}

function isObjectSchema(schema: TSchema): schema is TObject {
  return (
    schema.type === "object" &&
    schema.properties !== null &&
    typeof schema.properties === "object" &&
    !ArrayCtor.isArray(schema.properties)
  );
}

/** Builder namespace exported as `t`. */
export const t = {
  Any,
  Array,
  Boolean,
  Integer,
  Intersect,
  Literal,
  Never,
  Null,
  Number,
  Object,
  Omit,
  Optional,
  Partial,
  Pick,
  Readonly,
  Record,
  Required,
  String,
  Tuple,
  Union,
  Unknown,
};

export type { StaticProperties };
