import type { OpenApiPathItem, OpenApiSchema, OpenApiServer, OpenApiTag } from "./openapi-emitter";

export interface SwaggerDocumentOptions {
  title?: string;
  description?: string;
  version?: string;
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  paths?: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

/**
 * Chainable builder for top-level OpenAPI metadata (title, version, servers,
 * tags). Route discovery is automatic via `emitOpenApiDocument`; this builder
 * only exists for fields the framework cannot infer from controllers, plus an
 * escape hatch for manually-defined paths/components that override generated
 * output.
 */
export class DocumentBuilder {
  private readonly config: SwaggerDocumentOptions = {};

  setTitle(title: string): this {
    this.config.title = title;
    return this;
  }

  setDescription(description: string): this {
    this.config.description = description;
    return this;
  }

  setVersion(version: string): this {
    this.config.version = version;
    return this;
  }

  addServer(url: string, description?: string): this {
    (this.config.servers ??= []).push(description ? { url, description } : { url });
    return this;
  }

  addTag(name: string, description?: string): this {
    (this.config.tags ??= []).push(description ? { name, description } : { name });
    return this;
  }

  /**
   * Register a manual path operation that should override or augment the
   * auto-discovered one for the same `path`. Useful when the framework cannot
   * see a hand-rolled route (e.g. one registered directly on the adapter).
   */
  addPath(path: string, item: OpenApiPathItem): this {
    (this.config.paths ??= {})[path] = item;
    return this;
  }

  addSchema(name: string, schema: OpenApiSchema): this {
    const components = (this.config.components ??= {});
    (components.schemas ??= {})[name] = schema;
    return this;
  }

  build(): SwaggerDocumentOptions {
    return { ...this.config };
  }
}
