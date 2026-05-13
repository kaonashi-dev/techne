import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Module } from "../src/decorators/module.decorator";
import { TechneFactory, __resetTechneConfigCache } from "../src/factory/techne-factory";
import { RedisQueueDriver as QueueRedisDriver } from "../src/queue/drivers/redis";
import { RedisQueueDriver as MqRedisDriver } from "../src/mq/drivers/redis";
import { RedisClient } from "../src/microservices/transports/redis/redis-client";
import { RedisServer } from "../src/microservices/transports/redis/redis-server";
import { Logger } from "../src/services/logger.service";
import { emitOpenApiDocument, typeboxToOpenApi } from "../src/swagger";

describe("Techne migration regressions", () => {
  test("Redis-backed defaults use Techne key prefixes", () => {
    const queueDriver = new QueueRedisDriver({ client: {} } as any) as any;
    expect(queueDriver.baseKey("emails")).toBe("techne:queue:emails");

    const mqDriver = new MqRedisDriver({ client: {} } as any) as any;
    expect(mqDriver.waitKey("emails")).toBe("techne:mq:emails:wait");

    const redisClient = new RedisClient({ publisher: {}, subscriber: {} } as any) as any;
    expect(redisClient.channel("users.created")).toBe("techne:users.created");

    const redisServer = new RedisServer({ publisher: {}, subscriber: {} } as any) as any;
    expect(redisServer.responseChannel("abc")).toBe("techne:response:abc");
  });

  test("logger emits Techne in pretty and JSON modes", () => {
    const prevMode = Logger.getMode();
    const prevLog = console.log;
    const lines: string[] = [];
    console.log = (line?: unknown) => lines.push(String(line));

    try {
      Logger.setEnabled(true);
      Logger.setMode("pretty");
      new Logger("Test").log("hello");
      expect(lines.at(-1)).toContain("[Techne]");

      Logger.setMode("json");
      new Logger("Test").log("hello");
      expect(JSON.parse(lines.at(-1) ?? "{}").name).toBe("Techne");
    } finally {
      console.log = prevLog;
      Logger.setMode(prevMode);
      Logger.setEnabled(false);
    }
  });

  test("OpenAPI defaults use Techne title and unknown-kind marker", async () => {
    @Module({})
    class AppModule {}

    const app = await TechneFactory.create(AppModule, { logger: false });
    const doc = emitOpenApiDocument(app);
    expect(doc.info.title).toBe("Techne API");

    const unknown = typeboxToOpenApi({
      [Symbol.for("TypeBox.Kind")]: "CustomKind",
      custom: true,
    });
    expect(unknown["x-techne-unknown-kind"]).toBe("CustomKind");
    expect("x-bnest-unknown-kind" in unknown).toBe(false);
  });

  test("missing zero-arg config message points to techne.config.ts", async () => {
    const originalCwd = process.cwd();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "techne-migration-"));
    process.chdir(tempRoot);
    __resetTechneConfigCache();

    try {
      await expect(TechneFactory.create()).rejects.toThrow(/techne\.config\.ts/);
    } finally {
      process.chdir(originalCwd);
      __resetTechneConfigCache();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test("CLI help renders spaced techne commands", async () => {
    const proc = Bun.spawn(["bun", "src/cli/index.ts", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.resolve(import.meta.dir, ".."),
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("techne new <project-name>");
    expect(stdout).toContain("techne dev [--port N] [--inspect]");
    expect(stdout).not.toContain("technenew");
  });

  test("legacy bnest shim declares Techne re-export paths and CLI forwarder", async () => {
    const shimRoot = path.resolve(import.meta.dir, "..", "packages/bnest");
    const manifest = JSON.parse(await fs.readFile(path.join(shimRoot, "package.json"), "utf8"));
    const coreShim = await fs.readFile(path.join(shimRoot, "core.js"), "utf8");
    const cliShim = await fs.readFile(path.join(shimRoot, "bin/bnest.js"), "utf8");

    expect(manifest.name).toBe("@kaonashi-dev/bnest");
    expect(manifest.dependencies["@kaonashi-dev/techne"]).toBe("0.4.0");
    expect(manifest.exports["./core"].import).toBe("./core.js");
    expect(manifest.bin.bnest).toBe("./bin/bnest.js");
    expect(coreShim).toContain('export * from "@kaonashi-dev/techne/core"');
    expect(cliShim).toContain('Bun.spawn(["techne"');
  });
});
