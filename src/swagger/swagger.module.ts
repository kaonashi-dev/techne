import type { TechneApplication } from "../core/techne-application";
import { DocumentBuilder, type SwaggerDocumentOptions } from "./document-builder";
import { emitOpenApiDocument, type OpenApiDocument } from "./openapi-emitter";

/**
 * `createDocument` previously accepted either a `DocumentBuilder` instance or
 * the plain config object returned by `builder.build()`. We keep both shapes
 * working: callers wishing to opt into the new auto-discovery pipeline can pass
 * either, and the emitter will pick up title/version/etc. transparently.
 */
type BuilderOrConfig = DocumentBuilder | SwaggerDocumentOptions | undefined;

function toBuilder(input: BuilderOrConfig): DocumentBuilder | undefined {
  if (!input) return undefined;
  if (input instanceof DocumentBuilder) return input;

  // Rehydrate a builder from a plain config so the emitter sees the same
  // metadata it would from a chained instance.
  const builder = new DocumentBuilder();
  if (input.title) builder.setTitle(input.title);
  if (input.description) builder.setDescription(input.description);
  if (input.version) builder.setVersion(input.version);
  for (const server of input.servers ?? []) builder.addServer(server.url, server.description);
  for (const tag of input.tags ?? []) builder.addTag(tag.name, tag.description);
  for (const [path, item] of Object.entries(input.paths ?? {})) builder.addPath(path, item);
  for (const [name, schema] of Object.entries(input.components?.schemas ?? {})) {
    builder.addSchema(name, schema);
  }
  return builder;
}

export class SwaggerModule {
  /**
   * Build an OpenAPI 3.1 document from the application's registered routes
   * and the supplied builder/config. Routes are discovered automatically; any
   * paths explicitly added through the builder take precedence so callers can
   * patch the generated spec without forking it.
   */
  static createDocument(
    app: Pick<TechneApplication, "getRoutes">,
    builderOrConfig?: BuilderOrConfig,
  ): OpenApiDocument {
    return emitOpenApiDocument(app, toBuilder(builderOrConfig));
  }

  /** Alias for {@link createDocument} — emphasises the auto-discovery aspect. */
  static createAutoDocument(
    app: Pick<TechneApplication, "getRoutes">,
    builderOrConfig?: BuilderOrConfig,
  ): OpenApiDocument {
    return emitOpenApiDocument(app, toBuilder(builderOrConfig));
  }

  static setup(
    path: string,
    app: Pick<TechneApplication, "getHttpAdapter">,
    document: OpenApiDocument | (() => OpenApiDocument),
  ) {
    const adapter = app.getHttpAdapter() as any;
    const documentFactory = typeof document === "function" ? document : undefined;
    let cachedDocument = typeof document === "function" ? undefined : document;
    adapter.get(path, () => {
      if (cachedDocument) {
        return cachedDocument;
      }
      cachedDocument = documentFactory!();
      return cachedDocument;
    });
  }
}
