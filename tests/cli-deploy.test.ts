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
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "techne-cli-deploy-"));
    process.chdir(tempRoot);
  });
  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("defaults to a pinned binary build with a slim runtime", async () => {
    const result = await generateDockerfile({ dryRun: true });
    expect(result.dockerfile).toContain("ARG BUN_VERSION=1.4.4");
    expect(result.dockerfile).toContain("FROM oven/bun:${BUN_VERSION} AS builder");
    expect(result.dockerfile).toContain("RUN bun run build");
    expect(result.dockerfile).toContain("FROM debian:bookworm-slim AS runtime");
    expect(result.dockerfile).toContain("COPY --from=builder");
    expect(result.dockerfile).toContain('ENTRYPOINT ["/app/app"]');
    expect(result.dockerfile).toContain("EXPOSE 3000");
    expect(result.dockerfile).toContain("HEALTHCHECK");
    expect(result.dockerignore).not.toBeNull();
    expect(result.dockerignore).toContain("node_modules");
  });

  test("honors custom port", async () => {
    const result = await generateDockerfile({ dryRun: true, port: 8080 });
    expect(result.dockerfile).toContain("EXPOSE 8080");
    expect(result.dockerfile).toContain("ENV PORT=8080");
    expect(result.dockerfile).toContain("CMD /app/app --healthcheck || exit 1");
  });

  test("honors custom bun version", async () => {
    const result = await generateDockerfile({ dryRun: true, bunVersion: "1.1.30" });
    expect(result.dockerfile).toContain("ARG BUN_VERSION=1.1.30");
  });

  test("renders a bundle build with the Bun runtime", async () => {
    const result = await generateDockerfile({ dryRun: true, mode: "bundle", bunVersion: "1.1.30" });
    expect(result.dockerfile).toContain("RUN bun build src/main.ts");
    expect(result.dockerfile).toContain("FROM oven/bun:${BUN_VERSION}-slim AS runtime");
    expect(result.dockerfile).toContain('CMD ["./app.bun"]');
  });

  test("renders an AOT build with the canary tag by default", async () => {
    const result = await generateDockerfile({ dryRun: true, mode: "aot" });
    expect(result.dockerfile).toContain("ARG BUN_VERSION=canary");
    expect(result.dockerfile).toContain("RUN bun run build:aot");
    expect(result.dockerfile).toContain("FROM debian:bookworm-slim AS runtime");
  });

  test("writes Dockerfile and .dockerignore and refuses to overwrite without --force", async () => {
    await generateDockerfile({ outDir: tempRoot });
    expect(await Bun.file(path.join(tempRoot, "Dockerfile")).exists()).toBe(true);
    expect(await Bun.file(path.join(tempRoot, ".dockerignore")).exists()).toBe(true);
    await expect(generateDockerfile({ outDir: tempRoot })).rejects.toThrow(/refusing to overwrite/);
    // Force overwrites
    await generateDockerfile({ outDir: tempRoot, force: true, port: 4242 });
    const content = await Bun.file(path.join(tempRoot, "Dockerfile")).text();
    expect(content).toContain("EXPOSE 4242");
  });
});
