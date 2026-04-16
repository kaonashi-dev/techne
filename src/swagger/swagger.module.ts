import type { BnestApplication } from "../core/bnest-application";

function transformPathParams(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export class SwaggerModule {
  static createDocument(
    app: Pick<BnestApplication, "getRoutes">,
    config: Record<string, any> = {},
  ): Record<string, any> {
    const paths: Record<string, any> = {};

    for (const route of app.getRoutes()) {
      const path = transformPathParams(route.fullPath);
      const operation = route.method.toLowerCase();
      const entry = (paths[path] ??= {});
      const paramsSchema =
        route.schema?.params && typeof route.schema.params === "object"
          ? (route.schema.params as { properties?: Record<string, unknown> })
          : undefined;
      const paramsProperties = paramsSchema?.properties ?? {};
      entry[operation] = {
        responses: {
          200: {
            description: "Successful response",
            ...(route.schema?.response
              ? { content: { "application/json": { schema: route.schema.response } } }
              : {}),
          },
        },
        ...(route.schema?.body
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": {
                    schema: route.schema.body,
                  },
                },
              },
            }
          : {}),
        ...(paramsSchema
          ? {
              parameters: Object.keys(paramsProperties).map((key) => ({
                name: key,
                in: "path",
                required: true,
                schema: paramsProperties[key],
              })),
            }
          : {}),
      };
    }

    return {
      openapi: "3.0.0",
      info: {
        title: config.title ?? "Bnest API",
        description: config.description ?? "",
        version: config.version ?? "1.0.0",
      },
      paths,
    };
  }

  static setup(
    path: string,
    app: Pick<BnestApplication, "getHttpAdapter">,
    document: Record<string, any> | (() => Record<string, any>),
  ) {
    const adapter = app.getHttpAdapter() as any;
    const documentFactory = typeof document === "function" ? document : () => document;
    adapter.get(path, () => documentFactory());
  }
}
