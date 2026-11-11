import { describe, expect, test } from "bun:test";
import { buildPlan, detectAotSupport, formatBytes, type AotProbeResult } from "../src/cli/build";

const bun = "/fake/bun";
const entry = "src/main.ts";

describe("CLI build planner", () => {
  test("defaults a binary to minified output with a source map", () => {
    const plan = buildPlan({ entry, compile: true }, bun);
    expect(plan.kind).toBe("binary");
    expect(plan.outFile).toBe("dist/app");
    expect(plan.command).toEqual([
      bun,
      "build",
      "--compile",
      "--outfile=dist/app",
      "--minify",
      "--sourcemap",
      entry,
    ]);
  });

  test("builds an AOT binary with trim and explain", () => {
    const plan = buildPlan({ entry, aot: true, trim: true, explain: "json", out: "dist/aot" }, bun);
    expect(plan.kind).toBe("aot");
    expect(plan.outFile).toBe("dist/aot");
    expect(plan.command).toEqual([
      bun,
      "compile",
      "--no-script",
      "--outfile=dist/aot",
      "--minify",
      "--trim",
      "--explain=json",
      entry,
    ]);
  });

  test("AOT only emits an external source map when explicitly requested", () => {
    const plan = buildPlan({ entry, aot: true, sourcemap: true }, bun);
    expect(plan.command).toContain("--sourcemap=external");
  });

  test("rejects AOT cross-compilation", () => {
    expect(() => buildPlan({ entry, aot: true, target: "bun-linux-x64" }, bun)).toThrow(
      /cannot cross-compile/,
    );
  });

  test("requires --aot for trim and explain", () => {
    expect(() => buildPlan({ entry, compile: true, trim: true }, bun)).toThrow(/requires --aot/);
    expect(() => buildPlan({ entry, compile: true, explain: true }, bun)).toThrow(/requires --aot/);
  });

  test("bytecode implies ESM and is ignored with AOT", () => {
    const jit = buildPlan({ entry, compile: true, bytecode: true }, bun);
    expect(jit.command).toContain("--bytecode");
    expect(jit.command).toContain("--format=esm");

    const aot = buildPlan({ entry, aot: true, bytecode: true }, bun);
    expect(aot.command).not.toContain("--bytecode");
    expect(aot.warnings[0]).toContain("no effect");
  });

  test("passes assets/directories and defines through", () => {
    const plan = buildPlan(
      {
        entry,
        compile: true,
        assets: ["public", "templates"],
        defines: ['APP_VERSION="1.0.0"'],
      },
      bun,
    );
    expect(plan.command).toContain("--asset=public");
    expect(plan.command).toContain("--asset=templates");
    expect(plan.command).toContain('--define=APP_VERSION="1.0.0"');
  });

  test("bundle mode does not pass --compile", () => {
    const plan = buildPlan({ entry, target: "bun", compile: false }, bun);
    expect(plan.kind).toBe("bundle");
    expect(plan.outFile).toBe("dist/app.bun");
    expect(plan.command).toContain("--target=bun");
    expect(plan.command).not.toContain("--compile");
  });

  test("binary mode keeps an explicit cross-compilation target", () => {
    const plan = buildPlan(
      { entry, compile: true, target: "bun-linux-x64", out: "dist/app-linux" },
      bun,
    );
    expect(plan.command).toContain("--compile");
    expect(plan.command).toContain("--target=bun-linux-x64");
  });
});

describe("AOT feature detection", () => {
  const probe = (result: AotProbeResult) => () => result;

  test("accepts a Bun with the compile command", () => {
    expect(
      detectAotSupport(
        bun,
        probe({ exitCode: 0, stdout: "Usage: bun compile [flags]", stderr: "" }),
      ),
    ).toBe(true);
  });

  test("rejects stable Bun where compile is not a script", () => {
    expect(
      detectAotSupport(
        bun,
        probe({ exitCode: 1, stdout: "", stderr: 'error: Script not found "compile"' }),
      ),
    ).toBe(false);
  });
});

test("formats artifact sizes", () => {
  expect(formatBytes(0)).toBe("unknown size");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1.5 KiB");
  expect(formatBytes(1024 * 1024)).toBe("1.0 MiB");
});
