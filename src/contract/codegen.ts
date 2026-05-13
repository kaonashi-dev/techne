import type { BnestApplication } from "../core/techne-application";

// ─── TypeBox introspection ───────────────────────────────────────────────────
// Mirrors the pattern in `src/swagger/openapi-emitter.ts` — we read the
// `Symbol.for("TypeBox.Kind")` tag to discriminate node kinds, since the
// surface JSON-Schema-ish shape isn't always enough (Union vs. Literal).

const KIND = Symbol.for("TypeBox.Kind");
const OPTIONAL = Symbol.for("TypeBox.Optional");

type AnyTypeBox = {
  [KIND]?: string;
  [OPTIONAL]?: "Optional" | string;
  [key: string]: unknown;
};

function kindOf(node: unknown): string | undefined {
  if (!node || typeof node !== "object") return undefined;
  return (node as AnyTypeBox)[KIND];
}

function isOptional(node: unknown): boolean {
  return !!node && typeof node === "object" && (node as AnyTypeBox)[OPTIONAL] === "Optional";
}

/** Format a literal value as a TypeScript source-level expression. */
function formatLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "unknown";
}

/**
 * Convert a TypeBox schema node to a TypeScript type literal source string.
 *
 * Returns the inline representation (e.g. `{ id: string; name?: string }`),
 * NOT a wrapped `type Foo = ...` declaration. Optionality of object properties
 * is surfaced by the parent {@link emitObject} call — this function only
 * cares about the value shape.
 */
export function typeboxToTypeScript(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const node = schema as AnyTypeBox;
  const kind = kindOf(node);

  switch (kind) {
    case "String":
      return "string";
    case "Number":
    case "Integer":
      return "number";
    case "Boolean":
      return "boolean";
    case "Null":
      return "null";
    case "Any":
    case "Unknown":
      return "unknown";
    case "Never":
      return "never";
    case "Literal":
      return formatLiteral(node.const);
    case "Array": {
      const inner = typeboxToTypeScript(node.items);
      // Wrap unions so `(a | b)[]` parses correctly.
      return inner.includes("|") || inner.includes("&") ? `(${inner})[]` : `${inner}[]`;
    }
    case "Object":
      return emitObject(node);
    case "Union": {
      const members = ((node.anyOf ?? []) as unknown[]).map(typeboxToTypeScript);
      if (members.length === 0) return "never";
      return members.join(" | ");
    }
    case "Intersect": {
      const members = ((node.allOf ?? []) as unknown[]).map(typeboxToTypeScript);
      if (members.length === 0) return "unknown";
      return members.map((m) => (m.includes("|") ? `(${m})` : m)).join(" & ");
    }
    case "Tuple": {
      const items = (node.items ?? []) as unknown[];
      if (items.length === 0) return "[]";
      return `[${items.map(typeboxToTypeScript).join(", ")}]`;
    }
    case "Record": {
      // TypeBox `Record(K, V)` lowers to `{ patternProperties: { "...": V } }`.
      const pattern = node.patternProperties as Record<string, unknown> | undefined;
      const valueSchema = pattern ? Object.values(pattern)[0] : undefined;
      const valueType = valueSchema ? typeboxToTypeScript(valueSchema) : "unknown";
      return `Record<string, ${valueType}>`;
    }
  }

  return "unknown";
}

function emitObject(node: AnyTypeBox): string {
  const props = (node.properties ?? {}) as Record<string, unknown>;
  const keys = Object.keys(props);
  if (keys.length === 0) return "Record<string, unknown>";
  const lines: string[] = [];
  for (const key of keys) {
    const value = props[key];
    const optionalMark = isOptional(value) ? "?" : "";
    const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    lines.push(`${safeKey}${optionalMark}: ${typeboxToTypeScript(value)}`);
  }
  return `{ ${lines.join("; ")} }`;
}

// ─── Path-param inference ────────────────────────────────────────────────────

const PARAM_RE = /:([A-Za-z0-9_]+)/g;

function extractPathParamNames(path: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  PARAM_RE.lastIndex = 0;
  while ((match = PARAM_RE.exec(path)) !== null) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

/**
 * Build the TS literal for `params`. If a schema is declared, prefer that;
 * otherwise synthesize `{ [seg]: string }` from `:segment` placeholders so
 * users can still call `params: { id: "42" }` with type safety.
 */
function paramsTypeFor(path: string, schema: unknown): string {
  if (schema) return typeboxToTypeScript(schema);
  const names = extractPathParamNames(path);
  if (names.length === 0) return "undefined";
  return `{ ${names.map((n) => `${n}: string`).join("; ")} }`;
}

function slotTypeFor(schema: unknown): string {
  if (schema === undefined || schema === null) return "undefined";
  return typeboxToTypeScript(schema);
}

// ─── Public emitter ──────────────────────────────────────────────────────────

const HEADER = [
  "// AUTO-GENERATED by `bnest generate client`. Do not edit by hand.",
  "// Re-run after changing controllers/DTOs to refresh the route map.",
  "",
  `import type { RouteHandler } from "@kaonashi-dev/bnest/contract";`,
  "",
].join("\n");

/**
 * Walk `app.getRoutes()` and emit a TypeScript source file containing a single
 * `export type Routes = { ... }` declaration. The output is import-ready and
 * pairs with `createClient<Routes>(baseUrl)`.
 */
export function generateRoutesType(app: Pick<BnestApplication, "getRoutes">): string {
  type Operation = { method: string; entry: string };
  const grouped = new Map<string, Operation[]>();

  for (const route of app.getRoutes()) {
    const path = route.fullPath;
    const method = route.method.toLowerCase();
    const schema = route.schema ?? {};
    const bodyType = slotTypeFor(schema.body);
    const queryType = slotTypeFor(schema.query);
    const paramsType = paramsTypeFor(path, schema.params);
    const responseType =
      slotTypeFor(schema.response) === "undefined" ? "unknown" : slotTypeFor(schema.response);

    const entry = `RouteHandler<${bodyType}, ${queryType}, ${paramsType}, ${responseType}>`;
    const list = grouped.get(path) ?? [];
    list.push({ method, entry });
    grouped.set(path, list);
  }

  if (grouped.size === 0) {
    return `${HEADER}export type Routes = Record<string, never>;\n`;
  }

  const paths = [...grouped.keys()].sort();
  const lines: string[] = [HEADER, "export type Routes = {"];
  for (const path of paths) {
    lines.push(`  ${JSON.stringify(path)}: {`);
    const ops = grouped.get(path)!;
    // Stable method order so reruns produce identical diffs.
    ops.sort((a, b) => a.method.localeCompare(b.method));
    for (const op of ops) {
      lines.push(`    ${op.method}: ${op.entry};`);
    }
    lines.push("  };");
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}
