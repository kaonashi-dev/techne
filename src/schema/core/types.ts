/**
 * Types for Techne's schema builder and compiler.
 *
 * Schemas are plain JSON Schema objects. The only runtime addition the builder
 * makes is a non-enumerable {@link OptionalSymbol} marker on optional property
 * schemas, used to compute an object's `required` list while keeping the
 * serialized schema clean.
 */

/** Runtime marker for `t.Optional(...)`. Never enumerable, never serialized. */
export const OptionalSymbol: unique symbol = Symbol("Techne.Optional");

/** Type-only marker for `t.Readonly(...)`. */
export const ReadonlySymbol: unique symbol = Symbol("Techne.Readonly");

export interface SchemaOptions {
  [key: string]: unknown;
}

/** Base type for every schema produced by `t` or accepted by the compiler. */
export interface TSchema {
  readonly "~t"?: unknown;
  [key: string]: unknown;
}

/** Infers the runtime type represented by a schema. */
export type Static<S> = S extends { readonly "~t"?: infer T } ? T : unknown;

export type TProperties = Record<string, TSchema>;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

export type OptionalKeys<P extends TProperties> = {
  [K in keyof P]-?: P[K] extends { readonly [OptionalSymbol]: true } ? K : never;
}[keyof P];

export type RequiredKeys<P extends TProperties> = Exclude<keyof P, OptionalKeys<P>>;

/** The object type described by an object schema's properties. */
export type StaticProperties<P extends TProperties> = Prettify<
  { [K in RequiredKeys<P>]: Static<P[K]> } & { [K in OptionalKeys<P>]?: Static<P[K]> }
>;

export interface TString extends TSchema {
  type: "string";
  readonly "~t"?: string;
}

export interface TNumber extends TSchema {
  type: "number";
  readonly "~t"?: number;
}

export interface TInteger extends TSchema {
  type: "integer";
  readonly "~t"?: number;
}

export interface TBoolean extends TSchema {
  type: "boolean";
  readonly "~t"?: boolean;
}

export interface TNull extends TSchema {
  type: "null";
  readonly "~t"?: null;
}

export interface TAny extends TSchema {
  readonly "~t"?: unknown;
}

export interface TNever extends TSchema {
  not: TSchema;
  readonly "~t": never;
}

export interface TLiteral<
  V extends string | number | boolean | null = string | number | boolean | null,
> extends TSchema {
  type: "string" | "number" | "boolean" | "null";
  const: V;
  readonly "~t"?: V;
}

export interface TArray<T extends TSchema = TSchema> extends TSchema {
  type: "array";
  items: T;
  readonly "~t"?: Static<T>[];
}

export interface TTuple<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
  type: "array";
  items: T;
  additionalItems: false;
  minItems: number;
  readonly "~t"?: StaticTuple<T>;
}

type StaticTuple<T extends readonly TSchema[]> = {
  -readonly [K in keyof T]: T[K] extends TSchema ? Static<T[K]> : never;
};

export interface TObject<
  P extends TProperties = TProperties,
  T = StaticProperties<P>,
> extends TSchema {
  type: "object";
  properties: P;
  required?: readonly string[];
  readonly "~t"?: T;
}

export interface TUnion<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
  anyOf: T;
  readonly "~t"?: Static<T[number]>;
}

export type StaticIntersect<T extends readonly TSchema[], R = unknown> = T extends readonly [
  infer Left extends TSchema,
  ...infer Rest extends readonly TSchema[],
]
  ? StaticIntersect<Rest, R & Static<Left>>
  : R;

export interface TIntersect<T extends readonly TSchema[] = readonly TSchema[]> extends TSchema {
  allOf?: T;
  readonly "~t"?: StaticIntersect<T>;
}

export type StaticRecord<K, V> = Record<
  Extract<Static<K>, PropertyKey> extends never ? string : Extract<Static<K>, PropertyKey>,
  Static<V>
>;

export interface TRecord<K extends TSchema = TSchema, V extends TSchema = TSchema> extends TSchema {
  type: "object";
  patternProperties?: Record<string, V>;
  properties?: Record<string, V>;
  required?: readonly string[];
  readonly "~t"?: StaticRecord<K, V>;
}

export type TOptional<T extends TSchema> = T & { readonly [OptionalSymbol]: true };

export type TReadonly<T extends TSchema> = Omit<T, "~t"> & {
  readonly [ReadonlySymbol]: true;
  readonly "~t"?: Readonly<Static<T>>;
};

export interface StringOptions extends SchemaOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface NumberOptions extends SchemaOptions {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface ArrayOptions extends SchemaOptions {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface ObjectOptions extends SchemaOptions {
  additionalProperties?: boolean | TSchema;
  minProperties?: number;
  maxProperties?: number;
}

/** An issue reported by schema validation, using JSON Schema field names. */
export interface ValidationIssue {
  instancePath: string;
  message: string;
  keyword?: string;
  schemaPath?: string;
  params?: unknown;
}

/** A compiled schema validator. */
export interface Validator<S extends TSchema = TSchema> {
  Check(value: unknown): value is Static<S>;
  Errors(value: unknown): ValidationIssue[];
  Convert(value: unknown): unknown;
}
