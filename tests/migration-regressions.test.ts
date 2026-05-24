import { describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { TechneFactory, __resetTechneConfigCache } from "../src/factory/techne-factory";
import { RedisQueueDriver as QueueRedisDriver } from "../src/queue/drivers/redis";
import { RedisQueueDriver as MqRedisDriver } from "../src/mq/drivers/redis";
import { Logger, BufferSink } from "../src/services/logger.service";
import { emitOpenApiDocument, typeboxToOpenApi } from "../src/swagger";
describe("Techne migration regressions", () => {
  test("Redis-backed defaults use Techne key prefixes", () => {
    const queueDriver = new QueueRedisDriver({ client: {} } as any) as any;
    expect(queueDriver.baseKey("emails")).toBe("techne:queue:emails");
    const mqDriver = new MqRedisDriver({ client: {} } as any) as any;
    expect(mqDriver.waitKey("emails")).toBe("techne:mq:emails:wait");
  });
  test("logger emits Techne in pretty and JSON modes", () => {
    const prevSink = Logger.getSink();
    const prevMode = Logger.getMode();
    const buf = new BufferSink();
    Logger.setSink(buf);
    Logger.setMode("pretty");
    try {
      new Logger("Test").log("hello");
      expect(buf.lines.at(-1)).toContain("[Techne]");
      Logger.setMode("json");
      new Logger("Test").log("hello");
      expect(JSON.parse(buf.lines.at(-1) ?? "{}").name).toBe("Techne");
    } finally {
      Logger.setSink(prevSink);
      Logger.setMode(prevMode);
    }
  });
  test("OpenAPI defaults use Techne title and unknown-kind marker", async () => {
    const app = await TechneFactory.create({ logger: false });
    const doc = emitOpenApiDocument(app);
    expect(doc.info.title).toBe("Techne API");
    const unknown = typeboxToOpenApi({
      [Symbol.for("TypeBox.Kind")]: "CustomKind",
      custom: true,
    });
    expect(unknown["x-techne-unknown-kind"]).toBe("CustomKind");
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
});
