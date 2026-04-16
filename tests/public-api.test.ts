import { describe, expect, test } from "bun:test";

describe("public API", () => {
  test("exposes Nest-style common and core subpaths", async () => {
    const common = await import("@kaonashi-dev/bnest/common");
    const core = await import("@kaonashi-dev/bnest/core");

    expect(typeof common.Controller).toBe("function");
    expect(typeof common.Module).toBe("function");
    expect(typeof common.ValidationPipe).toBe("function");
    expect(typeof common.HttpException).toBe("function");
    expect(typeof core.BnestFactory).toBe("function");
    expect(typeof core.Reflector).toBe("function");
    expect(typeof core.Container).toBe("function");
  });

  test("keeps the root export minimal", async () => {
    const root = await import("@kaonashi-dev/bnest");

    expect(Object.keys(root).sort()).toEqual(["BnestApplication", "BnestFactory"]);
    expect("Controller" in root).toBe(false);
    expect("Reflector" in root).toBe(false);
    expect("Test" in root).toBe(false);
    expect("MemoryQueue" in root).toBe(false);
  });

  test("keeps queue decorators scoped to the queue subpath", async () => {
    const common = await import("@kaonashi-dev/bnest/common");
    const queue = await import("@kaonashi-dev/bnest/queue");

    expect("InjectQueue" in common).toBe(false);
    expect("Processor" in common).toBe(false);
    expect("Process" in common).toBe(false);
    expect(typeof queue.InjectQueue).toBe("function");
    expect(typeof queue.Processor).toBe("function");
    expect(typeof queue.Process).toBe("function");
  });
});
