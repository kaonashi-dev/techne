import { describe, expect, test } from "bun:test";
import { Inject } from "../src/decorators/inject.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  APP_CONFIG,
  ConfigModule,
  ConfigValidationError,
  InjectConfig,
  defineConfig,
  t,
  type AppConfig,
} from "../src/config";

const baseSchema = t.Object({
  PORT: t.Number(),
  DATABASE_URL: t.String(),
  DEBUG: t.Optional(t.Boolean()),
  TAGS: t.Array(t.String()),
});

describe("defineConfig", () => {
  test("coerces typed values from a custom source (happy path)", () => {
    const config = defineConfig({
      schema: baseSchema,
      source: {
        PORT: "3000",
        DATABASE_URL: "postgres://localhost/app",
        DEBUG: "true",
        TAGS: "alpha, beta , gamma",
      },
    });

    expect(config.values.PORT).toBe(3000);
    expect(config.values.DATABASE_URL).toBe("postgres://localhost/app");
    expect(config.values.DEBUG).toBe(true);
    expect(config.values.TAGS).toEqual(["alpha", "beta", "gamma"]);
    expect(config.get("PORT")).toBe(3000);
    expect(config.getOrThrow("DATABASE_URL")).toBe("postgres://localhost/app");
  });

  test("optional fields become undefined when env is missing or empty", () => {
    const config = defineConfig({
      schema: baseSchema,
      source: {
        PORT: "8080",
        DATABASE_URL: "memory://local",
        DEBUG: "",
        TAGS: "x",
      },
    });

    expect(config.values.DEBUG).toBeUndefined();
    expect(() => config.getOrThrow("DEBUG" as any)).toThrow(/Missing configuration value/);
  });

  test("missing required field throws ConfigValidationError mentioning the field", () => {
    let caught: unknown;
    try {
      defineConfig({
        schema: baseSchema,
        source: {
          PORT: "3000",
          // DATABASE_URL missing
          TAGS: "a,b",
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    expect((caught as Error).message).toContain("DATABASE_URL");
  });

  test("invalid number for PORT reports field name and received value", () => {
    let caught: unknown;
    try {
      defineConfig({
        schema: baseSchema,
        source: {
          PORT: "abc",
          DATABASE_URL: "postgres://x",
          TAGS: "a",
        },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigValidationError);
    const message = (caught as Error).message;
    expect(message).toContain("PORT");
    expect(message).toContain("abc");
    const failures = (caught as ConfigValidationError).failures;
    expect(failures.some((f) => f.field === "PORT" && f.received === "abc")).toBe(true);
  });

  test("boolean coercion accepts true/false aliases", () => {
    const truthy = ["true", "1", "yes", "on"];
    for (const value of truthy) {
      const c = defineConfig({
        schema: t.Object({ FLAG: t.Boolean() }),
        source: { FLAG: value },
      });
      expect(c.values.FLAG).toBe(true);
    }

    const falsy = ["false", "0", "no", "off"];
    for (const value of falsy) {
      const c = defineConfig({
        schema: t.Object({ FLAG: t.Boolean() }),
        source: { FLAG: value },
      });
      expect(c.values.FLAG).toBe(false);
    }
  });

  test("custom array separator splits values correctly", () => {
    const config = defineConfig({
      schema: t.Object({ HOSTS: t.Array(t.String()) }),
      source: { HOSTS: "a.example;b.example;c.example" },
      arraySeparator: ";",
    });

    expect(config.values.HOSTS).toEqual(["a.example", "b.example", "c.example"]);
  });

  test("array of numbers coerces each item", () => {
    const config = defineConfig({
      schema: t.Object({ PORTS: t.Array(t.Number()) }),
      source: { PORTS: "1,2,3" },
    });

    expect(config.values.PORTS).toEqual([1, 2, 3]);
  });

  test("ConfigModule.forApp exposes APP_CONFIG and InjectConfig resolves it", async () => {
    const config = defineConfig({
      schema: baseSchema,
      source: {
        PORT: "4242",
        DATABASE_URL: "postgres://di",
        TAGS: "one,two",
      },
    });

    @Injectable()
    class Consumer {
      constructor(
        @InjectConfig() readonly direct: AppConfig<typeof baseSchema>,
        @Inject(APP_CONFIG) readonly raw: AppConfig<typeof baseSchema>,
      ) {}
    }

    @Module({
      imports: [ConfigModule.forApp(config)],
      providers: [Consumer],
    })
    class AppModule {}

    const app = await TechneFactory.createApplicationContext(AppModule, { logger: false });
    const consumer = app.get<Consumer>(Consumer);

    expect(consumer.direct).toBe(config);
    expect(consumer.raw).toBe(config);
    expect(consumer.direct.get("PORT")).toBe(4242);
    expect(consumer.direct.values.TAGS).toEqual(["one", "two"]);

    await app.close();
  });
});
