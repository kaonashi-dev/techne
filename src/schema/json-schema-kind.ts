/**
 * Structural classification of JSON Schema nodes.
 *
 * Techne's schema consumers (OpenAPI emitter, contract codegen, fast
 * stringifier) all need to answer "what kind of node is this?" before they can
 * walk it. They used to answer it by reading `Symbol.for("TypeBox.Kind")`,
 * which TypeBox 0.34 stamped on every node it produced.
 *
 * TypeBox 1.x — the version Elysia 2 builds on — removed those symbol tags.
 * Its output is now plain, spec-clean JSON Schema, so `t.String()` is exactly
 * `{ type: "string" }` with nothing hidden on it. Classifying by structure
 * instead of by vendor tag is both the required fix and the better contract:
 * it works for schemas produced by `t` (Elysia), `Type` (TypeBox), and for
 * hand-written JSON Schema that never went through a builder at all.
 *
 * One consequence is worth stating plainly: **optionality is no longer a
 * property of the node.** In JSON Schema it lives in the parent object's
 * `required` array, so a lone `{ type: "string" }` carries no evidence of
 * whether it was declared optional. Callers must consult the parent — see
 * {@link requiredKeys}.
 */

export type SchemaKind =
  | "Object"
  | "Record"
  | "Array"
  | "Tuple"
  | "Union"
  | "Intersect"
  | "Literal"
  | "Enum"
  | "String"
  | "Number"
  | "Integer"
  | "Boolean"
  | "Null"
  | "Any"
  | "Never"
  | "Ref";

type Node = Record<string, unknown>;

/** TypeBox 0.34's node tag. Still read so 0.34-shaped schemas keep working. */
const LEGACY_KIND = Symbol.for("TypeBox.Kind");
/** TypeBox 0.34's per-property optional tag. */
const LEGACY_OPTIONAL = Symbol.for("TypeBox.Optional");

/**
 * Read an explicit kind tag, if the schema carries one.
 *
 * Two vendored TypeBox variants tag their nodes: 0.34 with the
 * `Symbol.for("TypeBox.Kind")` symbol, and some 1.x builds with a `~kind`
 * string property. Neither is guaranteed to be present — stock `typebox@1.3`
 * emits untagged JSON Schema — so this is an accelerator and a disambiguator,
 * not the primary mechanism. When a tag is there it is authoritative, because
 * it distinguishes cases structure cannot (a `Record` whose `patternProperties`
 * were erased, say).
 */
export function explicitKind(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const node = schema as Node;
  const tilde = node["~kind"];
  if (typeof tilde === "string") return tilde;
  const legacy = (node as Record<symbol, unknown>)[LEGACY_KIND];
  return typeof legacy === "string" ? legacy : undefined;
}

/** Kind tags we model; anything else is reported as unclassified. */
const KNOWN_KINDS = new Set<string>([
  "Object",
  "Record",
  "Array",
  "Tuple",
  "Union",
  "Intersect",
  "Literal",
  "Enum",
  "String",
  "Number",
  "Integer",
  "Boolean",
  "Null",
  "Any",
  "Never",
  "Ref",
]);

/**
 * Classify a JSON Schema node.
 *
 * Returns `undefined` for anything that isn't a recognizable node, which
 * callers treat as "pass through unchanged" rather than as an error — a schema
 * using a keyword we don't model should degrade, not throw.
 */
export function kindOf(schema: unknown): SchemaKind | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  const node = schema as Node;

  // An explicit tag wins when we recognize it. An unrecognized tag falls
  // through to structural analysis rather than short-circuiting, so a node
  // tagged with a custom kind but shaped like a plain object still converts.
  const tagged = explicitKind(node);
  if (tagged !== undefined) {
    // `Unknown` and `Any` are indistinguishable once serialized (both erase to
    // `{}`), so they collapse to one kind.
    if (tagged === "Unknown") return "Any";
    if (KNOWN_KINDS.has(tagged)) return tagged as SchemaKind;
  }

  // `Never` has no `type`; it is spelled as the schema that matches nothing.
  // Checked before the `type` switch since it carries no type at all.
  if (node.not !== undefined && Object.keys(node).length === 1) return "Never";

  // Reference and combinator keywords win over `type`, because a node may
  // legally carry both (e.g. `{ type: "string", const: "a" }` is a literal,
  // not a plain string, and must be classified as one).
  if (typeof node.$ref === "string") return "Ref";
  if (node.const !== undefined) return "Literal";
  if (Array.isArray(node.enum)) return "Enum";
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) return "Union";
  if (Array.isArray(node.allOf)) return "Intersect";

  switch (node.type) {
    case "object":
      // `Record(K, V)` lowers to patternProperties with no fixed `properties`.
      return node.patternProperties !== undefined && node.properties === undefined
        ? "Record"
        : "Object";
    case "array":
      // Draft 2020-12 spells tuples `prefixItems`; TypeBox 1.x still emits the
      // older array-valued `items`. Accept both.
      return Array.isArray(node.items) || Array.isArray(node.prefixItems) ? "Tuple" : "Array";
    case "string":
      return "String";
    case "number":
      return "Number";
    case "integer":
      return "Integer";
    case "boolean":
      return "Boolean";
    case "null":
      return "Null";
    default:
      break;
  }

  // `t.Any()` and `t.Unknown()` both erase to `{}`. Anything else untyped is
  // a schema shape we don't model — report it as unclassified so the caller
  // can pass it through verbatim.
  return Object.keys(node).length === 0 ? "Any" : undefined;
}

/**
 * The parent's `required` list as a Set, for optionality lookups.
 *
 * Property nodes that carry a legacy `Symbol.for("TypeBox.Optional")` tag or a
 * `~optional` marker are subtracted, so a 0.34-shaped schema whose `required`
 * array over-reports still yields the right answer.
 */
export function requiredKeys(schema: unknown): Set<string> {
  if (!schema || typeof schema !== "object") return new Set();
  const node = schema as Node;
  const required = node.required;
  const out = Array.isArray(required) ? new Set(required as string[]) : new Set<string>();
  if (out.size === 0) return out;

  const properties = node.properties;
  if (properties && typeof properties === "object") {
    for (const [key, value] of Object.entries(properties as Node)) {
      if (out.has(key) && isTaggedOptional(value)) out.delete(key);
    }
  }
  return out;
}

function isTaggedOptional(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const record = node as Node;
  if (record["~optional"] === true) return true;
  return (record as Record<symbol, unknown>)[LEGACY_OPTIONAL] === "Optional";
}

/**
 * Tuple members, normalized across the two spellings.
 *
 * TypeBox 1.x emits `items: [...]`; JSON Schema 2020-12 uses `prefixItems`.
 */
export function tupleMembers(schema: unknown): unknown[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Node;
  if (Array.isArray(node.prefixItems)) return node.prefixItems;
  if (Array.isArray(node.items)) return node.items;
  return [];
}

/** Union members, normalized across `anyOf` and `oneOf`. */
export function unionMembers(schema: unknown): unknown[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Node;
  if (Array.isArray(node.anyOf)) return node.anyOf;
  if (Array.isArray(node.oneOf)) return node.oneOf;
  return [];
}
