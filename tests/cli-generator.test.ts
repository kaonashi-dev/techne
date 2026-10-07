import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  createProject,
  generateCommand,
  generateResource,
  generateFeature,
  generateRoutes,
  generateMiddleware,
  generateGuard,
  generateFilter,
  generateHook,
  generateSchema,
} from "../src/cli/generators";

describe("CLI project generator", () => {
  let originalCwd: string;
  let tempRoot: string;
  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "techne-cli-"));
    process.chdir(tempRoot);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("generates a starter that typechecks and serves requests without decorators", async () => {
    await createProject("my-project");
    const projectDir = path.join(tempRoot, "my-project");
    const tsconfig = await Bun.file(path.join(projectDir, "tsconfig.json")).json();
    expect(tsconfig.compilerOptions.experimentalDecorators).toBeUndefined();
    expect(tsconfig.compilerOptions.emitDecoratorMetadata).toBeUndefined();
    expect(await Bun.file(path.join(projectDir, "techne.config.ts")).exists()).toBe(false);

    // Resolve the local package, without installing anything from the network.
    const modules = path.join(projectDir, "node_modules");
    await fs.mkdir(path.join(modules, "@kaonashi-dev"), { recursive: true });
    await fs.symlink(originalCwd, path.join(modules, "@kaonashi-dev", "techne"));
    await fs.symlink(
      path.join(originalCwd, "node_modules", "@types"),
      path.join(modules, "@types"),
    );

    process.chdir(projectDir);
    await generateResource("user-profiles");
    for (const generate of [
      generateFeature,
      generateRoutes,
      generateMiddleware,
      generateGuard,
      generateFilter,
      generateHook,
      generateSchema,
    ]) {
      await generate("example", path.join(projectDir, "src"));
    }
    for (const command of [
      [process.execPath, path.join(originalCwd, "node_modules/typescript/bin/tsc"), "--noEmit"],
      [process.execPath, "test"],
      [
        process.execPath,
        "run",
        "--bun",
        path.join(originalCwd, "node_modules/.bin/oxfmt"),
        "--check",
        ".",
      ],
      [
        process.execPath,
        path.join(originalCwd, "src/cli/index.ts"),
        "build",
        "--target=bun",
        "--out",
        "dist/app.bun",
      ],
      [process.execPath, path.join(originalCwd, "src/cli/index.ts"), "doctor"],
    ]) {
      const child = Bun.spawn(command, { cwd: projectDir, stdout: "pipe", stderr: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }).toEqual({
        exitCode: 0,
        output: "",
      });
    }
  }, 20_000);

  test("retains explicit legacy console command generation", async () => {
    await generateCommand("MigrateCommand");
    const content = await Bun.file(path.join(tempRoot, "src/commands/migrate.command.ts")).text();
    expect(content).toContain("class MigrateCommand");
    expect(content).toContain('@ConsoleCommand("migrate"');
  });

  test("fails when target directory is not empty", async () => {
    const projectDir = path.join(tempRoot, "existing-project");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(path.join(projectDir, "placeholder.txt"), "busy\n");
    await expect(createProject("existing-project")).rejects.toThrow(
      /already exists and is not empty/,
    );
  });
});
