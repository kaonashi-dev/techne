import type { TechneApplication } from "../core/techne-application";
import type { DocumentBuilder } from "./document-builder";
import {
  explicitKind,
  kindOf,
  requiredKeys,
  tupleMembers,
  unionMembers,
} from "../schema/json-schema-kind";

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

// ─── Schema detection ────────────────────────────────────────────────────────
// Node kinds are derived structurally from the JSON Schema itself. Techne's
// builder emits untagged JSON Schema, so classification uses structure rather
// than a vendor tag. See `src/schema/json-schema-kind.ts` for the rationale.
type AnySchema = { [key: string]: unknown };

// ─── Schema → OpenAPI conversion ─────────────────────────────────────────────

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
 * Convert a Techne schema node to an OpenAPI 3.1 schema object.
 *
 * Walks the schema structurally so `Union`, `Literal`, `Optional` and the other
 * builder shapes map to the OpenAPI 3.1 equivalents.
 */
/** @deprecated Renamed to {@link schemaToOpenApi}; Techne no longer uses TypeBox. */
export const typeboxToOpenApi = (schema: unknown): OpenApiSchema => schemaToOpenApi(schema);

export function schemaToOpenApi(schema: unknown): OpenApiSchema {
  if (!schema || typeof schema !== "object") return {};
  const node = schema as AnySchema;
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
      return {};
    case "Never":
      return { not: {} };
    case "Literal": {
      // OpenAPI 3.1 supports `const`. The literal's `type` is filled in by
      // the builder for older draft consumers; we mirror it for compatibility.
      const out: OpenApiSchema = { const: node.const };
      if (node.type) out.type = node.type as string;
      return out;
    }
    case "Array": {
      const items = node.items;
      return {
        type: "array",
        items: schemaToOpenApi(items),
        ...pickKeys(node, ARRAY_OPT_KEYS),
      };
    }
    case "Object": {
      const props = (node.properties ?? {}) as Record<string, unknown>;
      const properties: Record<string, OpenApiSchema> = {};
      // Optionality is a property of the parent in JSON Schema, not of the
      // child node, so it has to be read off `required` here rather than
      // probed per-value.
      const declaredRequired = requiredKeys(node);
      const required: string[] = [];
      for (const key of Object.keys(props)) {
        properties[key] = schemaToOpenApi(props[key]);
        if (declaredRequired.has(key)) required.push(key);
      }
      const out: OpenApiSchema = { type: "object", properties };
      if (required.length > 0) out.required = required;
      if (node.additionalProperties !== undefined) {
        out.additionalProperties =
          typeof node.additionalProperties === "object"
            ? schemaToOpenApi(node.additionalProperties)
            : (node.additionalProperties as boolean);
      }
      return out;
    }
    case "Union": {
      return { oneOf: unionMembers(node).map(schemaToOpenApi) };
    }
    case "Enum": {
      return { enum: node.enum as unknown[] };
    }
    case "Ref": {
      return { $ref: node.$ref as string };
    }
    case "Intersect": {
      const members = (node.allOf ?? []) as unknown[];
      return { allOf: members.map(schemaToOpenApi) };
    }
    case "Record": {
      // `Record(K, V)` lowers to `{ type: "object", patternProperties }`.
      // OpenAPI 3.1 understands `patternProperties` directly.
      return {
        type: "object",
        patternProperties: node.patternProperties as Record<string, OpenApiSchema>,
        additionalProperties: false,
      };
    }
    case "Tuple": {
      const items = tupleMembers(node);
      return {
        type: "array",
        prefixItems: items.map(schemaToOpenApi),
        minItems: items.length,
        maxItems: items.length,
      };
    }
  }

  // ─── Unknown kind ────────────────────────────────────────────────────────
  // Fall through with whatever JSON-Schema-shaped data the builder produced. We
  // attach a `x-techne-unknown-kind` marker so downstream tooling can spot the
  // gap without us silently corrupting the spec. The marker can only name the
  // kind when the node carried an explicit tag — untagged JSON Schema that we
  // failed to classify has no name to report.
  const fallback: OpenApiSchema = {};
  for (const key of Object.keys(node)) {
    fallback[key] = node[key] as unknown;
  }
  const tag = kind ?? explicitKind(node);
  if (tag) fallback["x-techne-unknown-kind"] = tag;
  return fallback;
}

// ─── Helpers for route → operation conversion ────────────────────────────────

function transformPathParams(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function paramsFromObjectSchema(schema: unknown, location: "path" | "query"): OpenApiParameter[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as AnySchema;
  if (kindOf(node) !== "Object") return [];
  const props = (node.properties ?? {}) as Record<string, unknown>;
  const required = requiredKeys(node);
  const out: OpenApiParameter[] = [];
  for (const name of Object.keys(props)) {
    const value = props[name];
    // Path parameters are required by definition — a route can't match without
    // them — so the schema's `required` list only governs query parameters.
    const isReq = location === "path" ? true : required.has(name);
    out.push({
      name,
      in: location,
      required: isReq,
      schema: schemaToOpenApi(value),
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
 * Each `CompiledRouteDefinition` contributes one operation; its
 * `schema.{params,query,body,response}` are converted via `schemaToOpenApi`.
 * Top-level metadata (title/version/description/servers/tags) comes from the
 * optional `DocumentBuilder`. Manually-added paths on the builder take
 * precedence over auto-discovered ones — this lets escape-hatch users override
 * a generated operation without forking the emitter.
 */
export function emitOpenApiDocument(
  app: Pick<TechneApplication, "getRoutes">,
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
        content: { "application/json": { schema: schemaToOpenApi(route.schema.response) } },
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
        content: { "application/json": { schema: schemaToOpenApi(route.schema.body) } },
      };
    }

    const pathItem = (paths[path] ??= {});
    pathItem[method] = operation;
  }

  // Manually-added paths from the builder win over auto-discovered ones.
  if (config.paths) {
    for (const [path, item] of Object.entries(config.paths)) {
      paths[path] = { ...paths[path], ...item };
    }
  }

  const components: OpenApiDocument["components"] = {
    schemas: {
      Problem: PROBLEM_SCHEMA,
      ...config.components?.schemas,
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
