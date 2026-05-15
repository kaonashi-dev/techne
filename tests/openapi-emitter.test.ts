import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { Schema } from "../src/schema";
import {
  DocumentBuilder,
  SwaggerModule,
  emitOpenApiDocument,
  typeboxToOpenApi,
  type OpenApiOperation,
} from "../src/swagger";
describe("openapi auto-emitter", () => {
  test("emits 3.1.0 with Problem schema and converts /:id to /{id}", async () => {
    @Controller("users")
    class UsersController {
      @Get("/:id", { params: Schema.Object({ id: Schema.String() }) })
      findOne() {
        return null;
      }
    }
    const app = await TechneFactory.create({
      controllers: [UsersController],
      logger: false,
    });
    const doc = emitOpenApiDocument(app);
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.components.schemas.Problem).toBeDefined();
    expect(doc.components.schemas.Problem.required).toEqual(["type", "title", "status"]);
    expect(doc.paths["/users/{id}"]).toBeDefined();
    const op = doc.paths["/users/{id}"].get as OpenApiOperation;
    expect(op.parameters?.[0]).toEqual({
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string" },
    });
    // Every operation gets a default error response wired to the Problem ref.
    expect((op.responses.default as any).content["application/problem+json"].schema).toEqual({
      $ref: "#/components/schemas/Problem",
    });
  });
  test("@Get with query schema produces parameters[].in = query and respects optional", async () => {
    @Controller("search")
    class SearchController {
      @Get("/", {
        query: Schema.Object({
          q: Schema.String(),
          page: Schema.Optional(Schema.String()),
        }),
      })
      search() {
        return [];
      }
    }
    const app = await TechneFactory.create({
      controllers: [SearchController],
      logger: false,
    });
    const doc = emitOpenApiDocument(app);
    const op = doc.paths["/search"].get as OpenApiOperation;
    const params = op.parameters ?? [];
    const q = params.find((p) => p.name === "q");
    const page = params.find((p) => p.name === "page");
    expect(q?.in).toBe("query");
    expect(q?.required).toBe(true);
    expect(q?.schema).toEqual({ type: "string" });
    expect(page?.in).toBe("query");
    expect(page?.required).toBe(false);
  });
  test("@Post body schema lands in requestBody.application/json", async () => {
    @Controller("posts")
    class PostsController {
      @Post("/", {
        body: Schema.Object({
          title: Schema.String({ minLength: 1 }),
          tags: Schema.Optional(Schema.Array(Schema.String())),
        }),
      })
      create() {
        return null;
      }
    }
    const app = await TechneFactory.create({
      controllers: [PostsController],
      logger: false,
    });
    const doc = emitOpenApiDocument(app);
    const op = doc.paths["/posts"].post as OpenApiOperation;
    const schema = op.requestBody!.content["application/json"].schema;
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["title"]);
    expect(schema.properties!.title).toEqual({ type: "string", minLength: 1 });
    expect(schema.properties!.tags).toEqual({ type: "array", items: { type: "string" } });
  });
  test("array body schema yields type: array with items", () => {
    const out = typeboxToOpenApi(Schema.Array(Schema.String({ minLength: 1 }), { minItems: 1 }));
    expect(out).toEqual({
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    });
  });
  test("typeboxToOpenApi covers union, literal, and any", () => {
    expect(typeboxToOpenApi(Schema.Union([Schema.String(), Schema.Number()]))).toEqual({
      oneOf: [{ type: "string" }, { type: "number" }],
    });
    expect(typeboxToOpenApi(Schema.Literal("draft"))).toMatchObject({ const: "draft" });
    expect(typeboxToOpenApi(Schema.Any())).toEqual({});
    expect(typeboxToOpenApi(Schema.Boolean())).toEqual({ type: "boolean" });
  });
  test("optional property is omitted from required[] but present in properties", () => {
    const schema = Schema.Object({
      keep: Schema.String(),
      maybe: Schema.Optional(Schema.String()),
    });
    const out = typeboxToOpenApi(schema);
    expect(out.required).toEqual(["keep"]);
    expect(Object.keys(out.properties ?? {})).toEqual(["keep", "maybe"]);
  });
  test("createDocument merges auto-discovered routes with builder.addPath()", async () => {
    @Controller("items")
    class ItemsController {
      @Get("/")
      list() {
        return [];
      }
    }
    const app = await TechneFactory.create({
      controllers: [ItemsController],
      logger: false,
    });
    const builder = new DocumentBuilder()
      .setTitle("My API")
      .setVersion("2.0.0")
      .addServer("https://api.example.com", "prod")
      .addPath("/legacy", {
        get: { responses: { "200": { description: "Legacy hand-rolled route" } } },
      });
    const doc = SwaggerModule.createDocument(app, builder);
    expect(doc.info.title).toBe("My API");
    expect(doc.info.version).toBe("2.0.0");
    expect(doc.servers?.[0]).toEqual({ url: "https://api.example.com", description: "prod" });
    // Auto-discovered.
    expect(doc.paths["/items"].get).toBeDefined();
    // Manual.
    expect(doc.paths["/legacy"].get).toBeDefined();
  });
  test("builder.addPath() overrides auto-discovered operation for the same path", async () => {
    @Controller("collisions")
    class CollisionsController {
      @Get("/")
      list() {
        return [];
      }
    }
    const app = await TechneFactory.create({
      controllers: [CollisionsController],
      logger: false,
    });
    const override = {
      get: {
        summary: "manual override",
        responses: { "200": { description: "manual" } },
      },
    };
    const builder = new DocumentBuilder().addPath("/collisions", override as any);
    const doc = SwaggerModule.createDocument(app, builder);
    expect((doc.paths["/collisions"].get as OpenApiOperation).summary).toBe("manual override");
  });
});
