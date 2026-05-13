import type { BnestApplication } from "../core/bnest-application";
import type { DocumentBuilder } from "./document-builder";

// ─── Public types ────────────────────────────────────────────────────────────

export interface OpenApiSchema {
  type?: string;
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  const?: unknown;
  enum?: unknown[];
  additionalProperties?: boolean | OpenApiSchema;
  description?: string;
  nullable?: boolean;
  $ref?: string;
  // Fallback / unknown-kind passthrough
  [key: string]: unknown;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema: OpenApiSchema;
  description?: string;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, { schema: OpenApiSchema }>;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content: Record<string, { schema: OpenApiSchema }>;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse | { $ref: string }>;
  [key: string]: unknown;
}

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>> & {
  parameters?: OpenApiParameter[];
};

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  paths: Record<string, OpenApiPathItem>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

// ─── TypeBox detection ───────────────────────────────────────────────────────
// TypeBox tags every schema node with `Symbol.for("TypeBox.Kind")` and marks
// optional properties with `Symbol.for("TypeBox.Optional")`. We use these to
// drive the conversion below.
const KIND = Symbol.for("TypeBox.Kind");
const OPTIONAL = Symbol.for("TypeBox.Optional");

type AnyTypeBox = {
  [KIND]?: string;
  [OPTIONAL]?: "Optional" | string;
  [key: string]: unknown;
};

function isOptional(schema: unknown): boolean {
  return !!schema && typeof schema === "object" && (schema as AnyTypeBox)[OPTIONAL] === "Optional";
}

function kindOf(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  return (schema as AnyTypeBox)[KIND];
}

// ─── TypeBox → OpenAPI conversion ────────────────────────────────────────────

const STRING_OPT_KEYS = ["minLength", "maxLength", "pattern", "format"] as const;
const NUMBER_OPT_KEYS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"] as const;
const ARRAY_OPT_KEYS = ["minItems", "maxItems", "uniqueItems"] as const;

function pickKeys<T extends Record<string, unknown>>(
  source: T,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

/**
 * Convert a TypeBox schema node to an OpenAPI 3.1 schema object.
 *
 * Walks the schema by inspecting `Symbol.for("TypeBox.Kind")` rather than the
 * `type` field, so we get accurate handling for `Union`, `Literal`, `Optional`,
 * etc. — all of which can produce surprising JSON Schema output.
 */
export function typeboxToOpenApi(schema: unknown): OpenApiSchema {
  if (!schema || typeof schema !== "object") return {};
  const node = schema as AnyTypeBox;
  const kind = kindOf(node);

  switch (kind) {
    case "String":
      return { type: "string", ...pickKeys(node, STRING_OPT_KEYS) };
    case "Number":
      return { type: "number", ...pickKeys(node, NUMBER_OPT_KEYS) };
    case "Integer":
      return { type: "integer", ...pickKeys(node, NUMBER_OPT_KEYS) };
    case "Boolean":
      return { type: "boolean" };
    case "Null":
      return { type: "null" };
    case "Any":
    case "Unknown":
      return {};
    case "Never":
      return { not: {} };
    case "Literal": {
      // OpenAPI 3.1 supports `const`. The literal's `type` is filled in by
      // TypeBox for older draft consumers; we mirror it for compatibility.
      const out: OpenApiSchema = { const: node.const };
      if (node.type) out.type = node.type as string;
      return out;
    }
    case "Array": {
      const items = node.items;
      return {
        type: "array",
        items: typeboxToOpenApi(items),
        ...pickKeys(node, ARRAY_OPT_KEYS),
      };
    }
    case "Object": {
      const props = (node.properties ?? {}) as Record<string, unknown>;
      const properties: Record<string, OpenApiSchema> = {};
      const required: string[] = [];
      for (const key of Object.keys(props)) {
        const value = props[key];
        properties[key] = typeboxToOpenApi(value);
        if (!isOptional(value)) required.push(key);
      }
      const out: OpenApiSchema = { type: "object", properties };
      if (required.length > 0) out.required = required;
      if (node.additionalProperties !== undefined) {
        out.additionalProperties =
          typeof node.additionalProperties === "object"
            ? typeboxToOpenApi(node.additionalProperties)
            : (node.additionalProperties as boolean);
      }
      return out;
    }
    case "Union": {
      const members = (node.anyOf ?? []) as unknown[];
      return { oneOf: members.map(typeboxToOpenApi) };
    }
    case "Intersect": {
      const members = (node.allOf ?? []) as unknown[];
      return { allOf: members.map(typeboxToOpenApi) };
    }
    case "Record": {
      // TypeBox `Record(K, V)` lowers to `{ type: "object", patternProperties }`.
      // OpenAPI 3.1 understands `patternProperties` directly.
      return {
        type: "object",
        patternProperties: node.patternProperties as Record<string, OpenApiSchema>,
        additionalProperties: false,
      };
    }
    case "Tuple": {
      const items = (node.items ?? []) as unknown[];
      return {
        type: "array",
        prefixItems: items.map(typeboxToOpenApi),
        minItems: items.length,
        maxItems: items.length,
      };
    }
  }

  // ─── Unknown kind ────────────────────────────────────────────────────────
  // Fall through with whatever JSON-Schema-shaped data TypeBox produced. We
  // attach a `x-techne-unknown-kind` marker so downstream tooling can spot the
  // gap without us silently corrupting the spec.
  const fallback: OpenApiSchema = {};
  for (const key of Object.keys(node)) {
    fallback[key] = node[key] as unknown;
  }
  if (kind) fallback["x-techne-unknown-kind"] = kind;
  return fallback;
}

// ─── Helpers for route → operation conversion ────────────────────────────────

function transformPathParams(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function paramsFromObjectSchema(
  schema: unknown,
  location: "path" | "query",
): OpenApiParameter[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as AnyTypeBox;
  if (kindOf(node) !== "Object") return [];
  const props = (node.properties ?? {}) as Record<string, unknown>;
  const required = new Set((node.required as string[]) ?? []);
  const out: OpenApiParameter[] = [];
  for (const name of Object.keys(props)) {
    const value = props[name];
    const isReq = location === "path" ? true : required.has(name) || !isOptional(value);
    out.push({
      name,
      in: location,
      required: isReq,
      schema: typeboxToOpenApi(value),
    });
  }
  return out;
}

interface BuilderInternals {
  build(): {
    title?: string;
    description?: string;
    version?: string;
    servers?: OpenApiServer[];
    tags?: OpenApiTag[];
    paths?: Record<string, OpenApiPathItem>;
    components?: { schemas?: Record<string, OpenApiSchema> };
  };
}

const PROBLEM_SCHEMA: OpenApiSchema = {
  type: "object",
  description: "RFC 7807 problem document (application/problem+json).",
  properties: {
    type: { type: "string", format: "uri" },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    code: { type: "string" },
    instance: { type: "string" },
    requestId: { type: "string" },
  },
  required: ["type", "title", "status"],
};

// ─── Emitter ─────────────────────────────────────────────────────────────────

/**
 * Walk the application's registered routes and produce an OpenAPI 3.1 document.
 *
 * Each `CompiledRouteDefinition` contributes one operation; its TypeBox
 * `schema.{params,query,body,response}` are converted via `typeboxToOpenApi`.
 * Top-level metadata (title/version/description/servers/tags) comes from the
 * optional `DocumentBuilder`. Manually-added paths on the builder take
 * precedence over auto-discovered ones — this lets escape-hatch users override
 * a generated operation without forking the emitter.
 */
export function emitOpenApiDocument(
  app: Pick<BnestApplication, "getRoutes">,
  builder?: DocumentBuilder,
): OpenApiDocument {
  const config = builder
    ? (builder as unknown as BuilderInternals).build()
    : ({} as ReturnType<BuilderInternals["build"]>);

  const paths: Record<string, OpenApiPathItem> = {};

  for (const route of app.getRoutes()) {
    const path = transformPathParams(route.fullPath);
    const method = route.method.toLowerCase() as HttpMethod;

    const parameters: OpenApiParameter[] = [
      ...paramsFromObjectSchema(route.schema?.params, "path"),
      ...paramsFromObjectSchema(route.schema?.query, "query"),
    ];

    const responses: OpenApiOperation["responses"] = {};
    if (route.schema?.response) {
      responses["200"] = {
        description: "Successful response",
        content: { "application/json": { schema: typeboxToOpenApi(route.schema.response) } },
      };
    } else {
      responses["200"] = { description: "OK" };
    }
    responses["default"] = {
      description: "Error response (RFC 7807 problem+json).",
      content: {
        "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } },
      },
    };

    const operation: OpenApiOperation = { responses };
    if (parameters.length > 0) operation.parameters = parameters;
    if (route.schema?.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: typeboxToOpenApi(route.schema.body) } },
      };
    }

    const pathItem = (paths[path] ??= {});
    pathItem[method] = operation;
  }

  // Manually-added paths from the builder win over auto-discovered ones.
  if (config.paths) {
    for (const [path, item] of Object.entries(config.paths)) {
      paths[path] = { ...(paths[path] ?? {}), ...item };
    }
  }

  const components: OpenApiDocument["components"] = {
    schemas: {
      Problem: PROBLEM_SCHEMA,
      ...(config.components?.schemas ?? {}),
    },
  };

  const doc: OpenApiDocument = {
    openapi: "3.1.0",
    info: {
      title: config.title ?? "Techne API",
      version: config.version ?? "1.0.0",
      ...(config.description ? { description: config.description } : {}),
    },
    paths,
    components,
  };

  if (config.servers && config.servers.length > 0) doc.servers = config.servers;
  if (config.tags && config.tags.length > 0) doc.tags = config.tags;

  return doc;
}
