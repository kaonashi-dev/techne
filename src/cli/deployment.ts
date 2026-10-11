import * as path from "node:path";

export interface DockerfileOptions {
  outDir?: string;
  projectName?: string;
  port?: number;
  bunVersion?: string;
  outName?: string;
  force?: boolean;
  dryRun?: boolean;
  writeDockerignore?: boolean;
}

function renderDockerfile(bunVersion: string, port: number): string {
  return `# syntax=docker/dockerfile:1.7
FROM oven/bun:${bunVersion} AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun build src/main.ts --target=bun --outfile=dist/app.bun --minify

FROM oven/bun:${bunVersion}-slim AS runtime
WORKDIR /app

RUN addgroup --system --gid 1001 techne && \\
    adduser --system --uid 1001 --ingroup techne techne

COPY --from=builder --chown=techne:techne /app/dist/app.bun ./app.bun

USER techne
ENV NODE_ENV=production
ENV PORT=${port}

EXPOSE ${port}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \\
  CMD bun -e "fetch('http://localhost:${port}/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./app.bun"]
`;
}

function renderDockerignore(): string {
  return `node_modules
dist
.git
.github
.claude
.cursor
.vscode
*.log
.env*
!.env.example
tests
benchmarks
README.md
*.md
coverage
`;
}

export async function generateDockerfile(
  opts: DockerfileOptions = {},
): Promise<{ dockerfile: string; dockerignore: string | null }> {
  const outDir = opts.outDir ?? process.cwd();
  const outName = opts.outName ?? "Dockerfile";
  const dockerfile = renderDockerfile(opts.bunVersion ?? "1", opts.port ?? 3000);
  const dockerignore = opts.writeDockerignore === false ? null : renderDockerignore();
  if (opts.dryRun) return { dockerfile, dockerignore };

  const files = [[path.join(outDir, outName), dockerfile]];
  if (dockerignore !== null) files.push([path.join(outDir, ".dockerignore"), dockerignore]);
  for (const [file] of files) {
    if (!opts.force && (await Bun.file(file).exists())) {
      throw new Error(
        `refusing to overwrite ${file}; pass --out or remove the existing file (use --force to override)`,
      );
    }
  }
  for (const [file, content] of files) {
    await Bun.write(file, content);
    console.log(`CREATE ${path.relative(process.cwd(), file)}`);
  }
  return { dockerfile, dockerignore };
}
