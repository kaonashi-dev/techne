import * as fs from "fs/promises";
import * as path from "path";

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function writeTextFile(filePath: string, content: string) {
  await fs.writeFile(filePath, `${content.trimEnd()}\n`);
  console.log(`CREATE ${path.relative(process.cwd(), filePath)}`);
}

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

RUN addgroup --system --gid 1001 bnest && \\
    adduser --system --uid 1001 --ingroup bnest bnest

COPY --from=builder --chown=bnest:bnest /app/dist/app.bun ./app.bun

USER bnest
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
  const port = opts.port ?? 3000;
  const bunVersion = opts.bunVersion ?? "1";
  const outName = opts.outName ?? "Dockerfile";
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;
  const writeDockerignore = opts.writeDockerignore ?? true;

  const dockerfile = renderDockerfile(bunVersion, port);
  const dockerignore = writeDockerignore ? renderDockerignore() : null;

  if (dryRun) {
    return { dockerfile, dockerignore };
  }

  const dockerfilePath = path.join(outDir, outName);
  if (!force) {
    const exists = await Bun.file(dockerfilePath).exists();
    if (exists) {
      throw new Error(
        `refusing to overwrite ${dockerfilePath}; pass --out or remove the existing file (use --force to override)`,
      );
    }
  }
  await Bun.write(dockerfilePath, dockerfile);
  console.log(`CREATE ${path.relative(process.cwd(), dockerfilePath)}`);

  if (dockerignore !== null) {
    const dockerignorePath = path.join(outDir, ".dockerignore");
    if (!force) {
      const exists = await Bun.file(dockerignorePath).exists();
      if (exists) {
        throw new Error(
          `refusing to overwrite ${dockerignorePath}; pass --out or remove the existing file (use --force to override)`,
        );
      }
    }
    await Bun.write(dockerignorePath, dockerignore);
    console.log(`CREATE ${path.relative(process.cwd(), dockerignorePath)}`);
  }

  return { dockerfile, dockerignore };
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeTextFile(filePath, JSON.stringify(value, null, 2));
}

async function ensureProjectDirectory(projectDir: string, projectName: string) {
  try {
    const entries = await fs.readdir(projectDir);
    if (entries.length > 0) {
      throw new Error(
        `Target directory "${projectName}" already exists and is not empty. Choose a new name or clear the directory first.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await fs.mkdir(projectDir, { recursive: true });
      return;
    }

    throw error;
  }
}

export async function generateModule(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Module`;
  const content = `import { Module } from "@kaonashi-dev/bnest/common";

@Module({
  controllers: [],
  providers: []
})
export class ${className} {}
`;
  await fs.writeFile(path.join(dir, `${name}.module.ts`), content);
  console.log(`CREATE ${name}.module.ts`);
}

export async function generateController(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Controller`;
  const content = `import { Controller, Get } from "@kaonashi-dev/bnest/common";

@Controller('${name}')
export class ${className} {
  @Get('/')
  findAll() {
    return [];
  }
}
`;
  await fs.writeFile(path.join(dir, `${name}.controller.ts`), content);
  console.log(`CREATE ${name}.controller.ts`);
}

export async function generateService(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Service`;
  const content = `import { Injectable } from "@kaonashi-dev/bnest/common";

@Injectable()
export class ${className} {}
`;
  await fs.writeFile(path.join(dir, `${name}.service.ts`), content);
  console.log(`CREATE ${name}.service.ts`);
}

export async function generateMiddleware(name: string, dir: string = ".") {
  const fnName = `${name}Middleware`;
  const content = `import type { ExecutionContext } from "@kaonashi-dev/bnest/common";

// TODO: implement ${fnName} logic.
export async function ${fnName}(context: ExecutionContext) {
  // Access request via context.switchToHttp().getRequest()
  return;
}
`;
  await fs.writeFile(path.join(dir, `${name}.middleware.ts`), content);
  console.log(`CREATE ${name}.middleware.ts`);
}

export async function generateGuard(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Guard`;
  const content = `import { Injectable, type CanActivate, type ExecutionContext } from "@kaonashi-dev/bnest/common";

@Injectable()
export class ${className} implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    // TODO: implement ${className} authorization logic.
    return true;
  }
}
`;
  await fs.writeFile(path.join(dir, `${name}.guard.ts`), content);
  console.log(`CREATE ${name}.guard.ts`);
}

export async function generatePipe(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Pipe`;
  const content = `import { Injectable, type PipeTransform } from "@kaonashi-dev/bnest/common";

@Injectable()
export class ${className} implements PipeTransform {
  transform(value: any) {
    // TODO: implement ${className} transformation logic.
    return value;
  }
}
`;
  await fs.writeFile(path.join(dir, `${name}.pipe.ts`), content);
  console.log(`CREATE ${name}.pipe.ts`);
}

export async function generateFilter(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Filter`;
  const content = `import { Catch, type ExceptionFilter, type ArgumentsHost } from "@kaonashi-dev/bnest/common";

@Catch()
export class ${className} implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // TODO: implement ${className} exception handling.
  }
}
`;
  await fs.writeFile(path.join(dir, `${name}.filter.ts`), content);
  console.log(`CREATE ${name}.filter.ts`);
}

export async function generateInterceptor(name: string, dir: string = ".") {
  const className = `${capitalize(name)}Interceptor`;
  const content = `import { Injectable, type BnestInterceptor, type ExecutionContext, type CallHandler } from "@kaonashi-dev/bnest/common";

@Injectable()
export class ${className} implements BnestInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    // TODO: implement ${className} interception logic.
    return next.handle();
  }
}
`;
  await fs.writeFile(path.join(dir, `${name}.interceptor.ts`), content);
  console.log(`CREATE ${name}.interceptor.ts`);
}

export async function generateDto(name: string, dir: string = ".") {
  const schemaName = `${capitalize(name)}Dto`;
  const content = `import { Schema } from "@kaonashi-dev/bnest/common";
import type { Static } from "@sinclair/typebox";

export const ${schemaName} = Schema.Object({
  // TODO: define fields for ${schemaName}
  example: Schema.String(),
});

export type ${schemaName} = Static<typeof ${schemaName}>;
`;
  await fs.writeFile(path.join(dir, `${name}.dto.ts`), content);
  console.log(`CREATE ${name}.dto.ts`);
}

export async function generateResource(name: string) {
  const dir = path.join(process.cwd(), "src", name);
  await fs.mkdir(dir, { recursive: true });

  const moduleName = `${capitalize(name)}Module`;
  const controllerName = `${capitalize(name)}Controller`;
  const serviceName = `${capitalize(name)}Service`;

  // Write Service
  await fs.writeFile(
    path.join(dir, `${name}.service.ts`),
    `import { Injectable } from "@kaonashi-dev/bnest/common";

@Injectable()
export class ${serviceName} {
  findAll() {
    return \`This action returns all ${name}\`;
  }

  findOne(id: string) {
    return \`This action returns a #${name} id:\${id}\`;
  }

  create(data: any) {
    return 'This action adds a new ${name}';
  }

  update(id: string, data: any) {
    return \`This action updates a #${name} id:\${id}\`;
  }

  remove(id: string) {
    return \`This action removes a #${name} id:\${id}\`;
  }
}
`,
  );
  console.log(`CREATE src/${name}/${name}.service.ts`);

  // Write Controller
  await fs.writeFile(
    path.join(dir, `${name}.controller.ts`),
    `import { Body, Controller, Delete, Get, Param, Post, Put } from "@kaonashi-dev/bnest/common";
import { ${serviceName} } from './${name}.service';

@Controller('${name}')
export class ${controllerName} {
  constructor(private readonly service: ${serviceName}) {}

  @Get('/')
  findAll() {
    return this.service.findAll();
  }

  @Get('/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('/')
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put('/:id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete('/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
`,
  );
  console.log(`CREATE src/${name}/${name}.controller.ts`);

  // Write Module
  await fs.writeFile(
    path.join(dir, `${name}.module.ts`),
    `import { Module } from "@kaonashi-dev/bnest/common";
import { ${controllerName} } from './${name}.controller';
import { ${serviceName} } from './${name}.service';

@Module({
  controllers: [${controllerName}],
  providers: [${serviceName}]
})
export class ${moduleName} {}
`,
  );
  console.log(`CREATE src/${name}/${name}.module.ts`);
}

export async function createProject(name: string) {
  const dir = path.join(process.cwd(), name);
  await ensureProjectDirectory(dir, name);

  const srcDir = path.join(dir, "src");
  await fs.mkdir(srcDir, { recursive: true });

  await writeJsonFile(path.join(dir, "package.json"), {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "bun --hot run src/main.ts",
      start: "bun run src/main.ts",
      build: "bun build src/main.ts --target=bun --outfile=dist/app.bun --minify",
      "build:node": "bun build src/main.ts --target=node --outdir=dist --format=esm --minify",
      lint: "oxlint .",
      "lint:fix": "oxlint --fix .",
      format: "oxfmt .",
      "format:check": "oxfmt --check .",
      check: "bun run lint && bun run format:check",
      "check:fix": "bun run lint:fix && bun run format",
    },
    dependencies: {
      "@kaonashi-dev/bnest": "latest",
    },
    devDependencies: {
      "@types/bun": "latest",
      oxfmt: "^0.41.0",
      oxlint: "^1.56.0",
      typescript: "^5.0.0",
    },
  });

  await writeJsonFile(path.join(dir, "tsconfig.json"), {
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      allowSyntheticDefaultImports: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      noEmit: true,
      types: ["bun-types"],
    },
    include: ["src/**/*"],
  });

  await writeTextFile(
    path.join(dir, ".gitignore"),
    `node_modules
dist
coverage
.DS_Store
.env
.env.local
.env.production.local
.env.development.local
.env.test.local
`,
  );

  await writeJsonFile(path.join(dir, "oxlint.json"), {
    $schema: "./node_modules/oxlint/configuration_schema.json",
    plugins: ["typescript"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      pedantic: "off",
      perf: "warn",
      style: "off",
    },
    rules: {
      "no-unused-vars": "off",
      "typescript/no-explicit-any": "off",
      "typescript/ban-types": "off",
      "no-prototype-builtins": "off",
    },
    ignorePatterns: ["dist/", "node_modules/"],
  });

  await writeJsonFile(path.join(dir, ".oxfmtrc.json"), {
    $schema: "./node_modules/oxfmt/configuration_schema.json",
    ignorePatterns: ["*.md", "*.json", ".*.json"],
  });

  await writeTextFile(
    path.join(dir, "README.md"),
    `# ${capitalize(name)}

Starter project generated with Bnest.

## Scripts

- \`bun run dev\` - start the app in watch mode
- \`bun run start\` - run the app once
- \`bun run build\` - build a Bun binary bundle
- \`bun run build:node\` - build a Node-compatible ESM bundle
- \`bun run check\` - run lint and format checks

## Getting Started

\`\`\`bash
bun install
bun run dev
\`\`\`
`,
  );

  await writeTextFile(
    path.join(srcDir, "app.service.ts"),
    `import { Injectable } from "@kaonashi-dev/bnest/common";

@Injectable()
export class AppService {
  getHello() {
    return {
      message: "Hello from Bnest!",
    };
  }
}
`,
  );

  await writeTextFile(
    path.join(srcDir, "app.controller.ts"),
    `import { Controller, Get } from "@kaonashi-dev/bnest/common";
import { AppService } from "./app.service";

@Controller("/")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/")
  getHello() {
    return this.appService.getHello();
  }
}
`,
  );

  await writeTextFile(
    path.join(srcDir, "app.module.ts"),
    `import { Module } from "@kaonashi-dev/bnest/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`,
  );

  await writeTextFile(
    path.join(dir, "bnest.config.ts"),
    `import { defineBnestConfig } from "@kaonashi-dev/bnest/core";
import { AppModule } from "./src/app.module";

export default defineBnestConfig({
  module: AppModule,
  port: Number(Bun.env.PORT ?? 3000),
  cors: { origin: true },
  logger: "pretty",
});
`,
  );

  await writeTextFile(
    path.join(srcDir, "main.ts"),
    `import { bootstrap } from "@kaonashi-dev/bnest/core";

await bootstrap();
`,
  );

  await generateDockerfile({
    outDir: dir,
    projectName: name,
    port: 3000,
    bunVersion: "1",
  });

  console.log(`\nProject ${name} created successfully.`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  bun install`);
  console.log(`  bun run dev`);
  console.log(`  docker build -t ${name} .`);
  console.log(`  docker run -p 3000:3000 ${name}\n`);
}
