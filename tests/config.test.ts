import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Inject } from "../src/decorators/inject.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";
import { BnestFactory } from "../src/factory/techne-factory";
import { ConfigModule, ConfigService, registerAs } from "../src/config";

describe("ConfigModule", () => {
  let tempDir: string;
  let previousEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bnest-config-"));
    previousEnv = {
      APP_NAME: process.env.APP_NAME,
      DATABASE_URL: process.env.DATABASE_URL,
      PORT: process.env.PORT,
      EXPANDED_URL: process.env.EXPANDED_URL,
    };
  });

  afterEach(async () => {
    process.env.APP_NAME = previousEnv.APP_NAME;
    process.env.DATABASE_URL = previousEnv.DATABASE_URL;
    process.env.PORT = previousEnv.PORT;
    process.env.EXPANDED_URL = previousEnv.EXPANDED_URL;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("loads env files, merges load factories, validates and exposes feature config", async () => {
    const envFile = path.join(tempDir, ".env");
    await fs.writeFile(
      envFile,
      [
        "APP_NAME=from-file",
        "PORT=3001",
        "DATABASE_URL=postgres://db",
        "EXPANDED_URL=${DATABASE_URL}",
      ].join("\n"),
    );

    process.env.APP_NAME = "from-process";

    const databaseConfig = registerAs("database", () => ({
      url: process.env.DATABASE_URL ?? "memory://local",
      poolSize: 5,
    }));

    @Injectable()
    class ConfigConsumer {
      constructor(
        private readonly config: ConfigService,
        @Inject(databaseConfig.KEY) public readonly database: { url: string; poolSize: number },
      ) {}

      snapshot() {
        return {
          appName: this.config.get("APP_NAME"),
          port: this.config.get<number>("PORT"),
          expanded: this.config.get("EXPANDED_URL"),
          featureUrl: this.database.url,
          featurePool: this.database.poolSize,
          nestedValue: this.config.get("runtime.enabled"),
        };
      }
    }

    @Module({
      imports: [
        ConfigModule.forRoot({
          envFilePath: envFile,
          isGlobal: true,
          expandVariables: true,
          load: [() => ({ runtime: { enabled: true } })],
          validate: (config) => ({ ...config, PORT: Number(config.PORT) }),
        }),
        ConfigModule.forFeature(databaseConfig),
      ],
      providers: [ConfigConsumer],
    })
    class AppModule {}

    const app = await BnestFactory.createApplicationContext(AppModule, { logger: false });
    const consumer = app.get<ConfigConsumer>(ConfigConsumer);

    expect(consumer.snapshot()).toEqual({
      appName: "from-process",
      port: 3001,
      expanded: "postgres://db",
      featureUrl: "postgres://db",
      featurePool: 5,
      nestedValue: true,
    });
    expect(app.get<ConfigService>(ConfigService).getOrThrow("APP_NAME")).toBe("from-process");

    await app.close();
  });
});
