import { describe, expect, test } from "bun:test";

describe("public API", () => {
  test("exposes Techne common and core subpaths", async () => {
    const common = await import("@kaonashi-dev/techne/common");
    const core = await import("@kaonashi-dev/techne/core");
    const config = await import("@kaonashi-dev/techne/config");
    const jwt = await import("@kaonashi-dev/techne/jwt");
    const swagger = await import("@kaonashi-dev/techne/swagger");

    expect(typeof common.Controller).toBe("function");
    expect(typeof common.Module).toBe("function");
    expect(typeof common.ValidationPipe).toBe("function");
    expect(typeof common.HttpException).toBe("function");
    expect(typeof common.Scope).toBe("object");
    expect(typeof common.Public).toBe("function");
    expect(typeof core.TechneFactory).toBe("function");
    expect(typeof core.Reflector).toBe("function");
    expect(typeof core.Container).toBe("function");
    expect(typeof core.ContextIdFactory).toBe("function");
    expect(typeof core.ModuleRef).toBe("function");
    expect(typeof config.ConfigModule).toBe("function");
    expect(typeof config.ConfigService).toBe("function");
    expect(typeof jwt.JwtModule).toBe("function");
    expect(typeof jwt.JwtService).toBe("function");
    expect(typeof swagger.SwaggerModule).toBe("function");
  });

  test("keeps the root export minimal", async () => {
    const root = await import("@kaonashi-dev/techne");

    // The root export keeps a minimal surface but now exposes both the legacy
    // Bnest* names and the canonical Techne* aliases introduced for the rename.
    expect(Object.keys(root).sort()).toEqual([
      "BnestApplication",
      "BnestFactory",
      "TechneApplication",
      "TechneFactory",
    ]);
    expect("Controller" in root).toBe(false);
    expect("Reflector" in root).toBe(false);
    expect("Test" in root).toBe(false);
    expect("MemoryQueue" in root).toBe(false);
  });

  test("keeps queue decorators scoped to the queue subpath", async () => {
    const common = await import("@kaonashi-dev/techne/common");
    const mq = await import("@kaonashi-dev/techne/mq");
    const queue = await import("@kaonashi-dev/techne/queue");

    expect("InjectQueue" in common).toBe(false);
    expect("Processor" in common).toBe(false);
    expect("Process" in common).toBe(false);
    expect(typeof mq.InjectMq).toBe("function");
    expect(typeof mq.MqProcessor).toBe("function");
    expect(typeof mq.MqProcess).toBe("function");
    expect(typeof mq.MqModule).toBe("function");
    expect(typeof queue.Queue).toBe("function");
    expect(typeof queue.Worker).toBe("function");
    expect("InjectQueue" in queue).toBe(false);
    expect("Processor" in queue).toBe(false);
    expect("Process" in queue).toBe(false);
  });
});
