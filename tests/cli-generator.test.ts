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
import { hasNativeLint, NATIVE_LINT_MISSING } from "../src/cli/lint";

const nativeLint = await hasNativeLint();

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
    const cli = path.join(originalCwd, "src/cli/index.ts");
    const pkg = await Bun.file(path.join(projectDir, "package.json")).json();
    expect(pkg.scripts.lint).toBe("techne lint");
    expect(pkg.scripts.build).toBe("techne build");
    expect(pkg.scripts["build:aot"]).toContain("--aot");
    expect(pkg.engines.bun).toContain("1.4.4");
    expect(pkg.packageManager).toBe("bun@1.4.4");
    expect(pkg.devDependencies["@types/bun"]).toBe("^1.4.4");
    expect((await Bun.file(path.join(projectDir, ".bun-version")).text()).trim()).toBe("1.4.4");
    for (const command of [
      [process.execPath, path.join(originalCwd, "node_modules/typescript/bin/tsc"), "--noEmit"],
      [process.execPath, "test"],
      [process.execPath, "fmt", "--check", "--no-script"],
      ...(nativeLint ? [[process.execPath, cli, "lint"]] : []),
      [process.execPath, cli, "build", "--target=bun", "--out", "dist/app.bun"],
      [process.execPath, cli, "doctor"],
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
  }, 60_000);

  test.skipIf(nativeLint)(
    "techne lint fails fast when bun lint is unavailable",
    async () => {
      // Mirrors a generated project on stable Bun: the `lint` script calls `techne lint`.
      await Bun.write(
        path.join(tempRoot, "package.json"),
        JSON.stringify({
          scripts: { lint: `bun ${path.join(originalCwd, "src/cli/index.ts")} lint` },
        }),
      );
      const child = Bun.spawn([process.execPath, "run", "lint"], {
        cwd: tempRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toContain(NATIVE_LINT_MISSING);
    },
    10_000,
  );

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
