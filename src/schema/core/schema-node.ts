/**
 * Structural JSON Schema node used by the internal compiler.
 *
 * Public schemas stay plain `TSchema` objects. The compiler walks them on
 * every request path, so it needs a shape it can reason about without casting
 * each child to `any`. This type is intentionally structural and permissive:
 * the keywords Techne emits are typed; consumers that need a custom keyword
 * can narrow their own view (the compiler does not read one).
 *
 * A JSON Schema value is a node, a boolean (true/false schema) or `null`
 * (treated as an absent schema by the compiler).
 */
export type SchemaValue = SchemaNode | boolean | null;

export interface SchemaNode {
  type?: string | readonly string[];
  const?: unknown;
  enum?: readonly unknown[];
  allOf?: readonly SchemaValue[];
  anyOf?: readonly SchemaValue[];
  oneOf?: readonly SchemaValue[];
  not?: SchemaValue;
  properties?: Readonly<Record<string, SchemaValue>>;
  patternProperties?: Readonly<Record<string, SchemaValue>>;
  required?: readonly string[];
  items?: SchemaValue | readonly SchemaValue[];
  prefixItems?: readonly SchemaValue[];
  additionalItems?: SchemaValue;
  additionalProperties?: SchemaValue;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
}

const EMPTY_PROPERTIES: Readonly<Record<string, SchemaValue>> = Object.freeze({});

/** True for an object schema node (JSON Schema arrays are not nodes). */
export function isSchemaNode(value: unknown): value is SchemaNode {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True for an array of schema values. */
export function isSchemaArray(value: unknown): value is readonly SchemaValue[] {
  return Array.isArray(value);
}

/** Normalize the two tuple spellings (`prefixItems`, array-valued `items`). */
export function schemaArray(value: unknown): readonly SchemaValue[] | undefined {
  return isSchemaArray(value) ? value : undefined;
}

/** Properties with a shared empty object, avoiding a per-call allocation. */
export function schemaProperties(node: SchemaNode): Readonly<Record<string, SchemaValue>> {
  return node.properties ?? EMPTY_PROPERTIES;
}

/** Pattern properties with a shared empty object. */
export function schemaPatterns(node: SchemaNode): Readonly<Record<string, SchemaValue>> {
  return node.patternProperties ?? EMPTY_PROPERTIES;
}

/** Tuple members across `prefixItems` and array-valued `items`. */
export function schemaTuple(node: SchemaNode): readonly SchemaValue[] | undefined {
  return schemaArray(node.prefixItems) ?? schemaArray(node.items);
}

/** A single item schema; arrays are tuples and have no single item keyword. */
export function schemaItem(node: SchemaNode): SchemaValue {
  return isSchemaArray(node.items) ? true : (node.items ?? true);
}
