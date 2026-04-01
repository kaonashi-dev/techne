import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { createProject } from "../src/cli/generators";

describe("CLI project generator", () => {
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bnest-cli-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("creates a complete starter project", async () => {
    await createProject("my-project");

    const projectDir = path.join(tempRoot, "my-project");
    const packageJson = JSON.parse(
      await fs.readFile(path.join(projectDir, "package.json"), "utf8"),
    );
    const tsconfig = JSON.parse(await fs.readFile(path.join(projectDir, "tsconfig.json"), "utf8"));
    const oxlint = JSON.parse(await fs.readFile(path.join(projectDir, "oxlint.json"), "utf8"));
    const oxfmt = JSON.parse(await fs.readFile(path.join(projectDir, ".oxfmtrc.json"), "utf8"));
    const appModule = await fs.readFile(path.join(projectDir, "src", "app.module.ts"), "utf8");
    const appController = await fs.readFile(
      path.join(projectDir, "src", "app.controller.ts"),
      "utf8",
    );
    const appService = await fs.readFile(path.join(projectDir, "src", "app.service.ts"), "utf8");
    const mainFile = await fs.readFile(path.join(projectDir, "src", "main.ts"), "utf8");
    const gitignore = await fs.readFile(path.join(projectDir, ".gitignore"), "utf8");

    expect(packageJson.dependencies["@kaonashi-dev/bnest"]).toBe("latest");
    expect(packageJson.scripts.build).toContain("bun build src/main.ts");
    expect(packageJson.scripts.check).toBe("bun run lint && bun run format:check");
    expect(packageJson.devDependencies.oxlint).toBe("^1.56.0");
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
    expect(tsconfig.include).toEqual(["src/**/*"]);
    expect(oxlint.plugins).toEqual(["typescript"]);
    expect(oxfmt.ignorePatterns).toEqual(["*.md", "*.json", ".*.json"]);
    expect(appModule).toContain("AppController");
    expect(appModule).toContain("AppService");
    expect(appController).toContain('@Controller("/")');
    expect(appService).toContain("Hello from Bnest!");
    expect(mainFile).toContain("const port = Number(Bun.env.PORT ?? 3000);");
    expect(gitignore).toContain("node_modules");
    expect(gitignore).toContain("dist");
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
