import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { generateDockerfile } from "../src/cli/generators";

describe("CLI Dockerfile generator", () => {
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bnest-cli-deploy-"));
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("renders defaults (bun:1, port 3000, healthcheck) in dry-run", async () => {
    const result = await generateDockerfile({ dryRun: true });

    expect(result.dockerfile).toContain("FROM oven/bun:1");
    expect(result.dockerfile).toContain("EXPOSE 3000");
    expect(result.dockerfile).toContain("HEALTHCHECK");
    expect(result.dockerignore).not.toBeNull();
    expect(result.dockerignore).toContain("node_modules");
  });

  test("honors custom port", async () => {
    const result = await generateDockerfile({ dryRun: true, port: 8080 });
    expect(result.dockerfile).toContain("EXPOSE 8080");
    expect(result.dockerfile).toContain("ENV PORT=8080");
    expect(result.dockerfile).toContain("http://localhost:8080/healthz");
  });

  test("honors custom bun version", async () => {
    const result = await generateDockerfile({ dryRun: true, bunVersion: "1.1.30" });
    expect(result.dockerfile).toContain("FROM oven/bun:1.1.30 AS builder");
    expect(result.dockerfile).toContain("FROM oven/bun:1.1.30-slim AS runtime");
  });

  test("writes Dockerfile and .dockerignore and refuses to overwrite without --force", async () => {
    await generateDockerfile({ outDir: tempRoot });
    expect(await Bun.file(path.join(tempRoot, "Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(path.join(tempRoot, ".dockerignore")).exists()).toBe(true);

    await expect(generateDockerfile({ outDir: tempRoot })).rejects.toThrow(
      /refusing to overwrite/,
    );

    // Force overwrites
    await generateDockerfile({ outDir: tempRoot, force: true, port: 4242 });
    const content = await Bun.file(path.join(tempRoot, "Dockerfile")).text();
    expect(content).toContain("EXPOSE 4242");
  });
});
