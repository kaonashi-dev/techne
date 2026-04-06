import * as fs from "fs/promises";
import * as path from "path";

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function writeTextFile(filePath: string, content: string) {
  await fs.writeFile(filePath, `${content.trimEnd()}\n`);
  console.log(`CREATE ${path.relative(process.cwd(), filePath)}`);
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
  const content = `import { Module } from 'bnest';

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
  const content = `import { Controller, Get } from 'bnest';

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
  const content = `import { Injectable } from 'bnest';

@Injectable()
export class ${className} {}
`;
  await fs.writeFile(path.join(dir, `${name}.service.ts`), content);
  console.log(`CREATE ${name}.service.ts`);
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
    `import { Injectable } from 'bnest';

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
    `import { Controller, Get, Post, Put, Delete, Body, Param } from 'bnest';
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
    `import { Module } from 'bnest';
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
    `import { Injectable } from "@kaonashi-dev/bnest";

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
    `import { Controller, Get } from "@kaonashi-dev/bnest";
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
    `import { Module } from "@kaonashi-dev/bnest";
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
    path.join(srcDir, "main.ts"),
    `import { BnestFactory } from "@kaonashi-dev/bnest";
import { AppModule } from "./app.module";

const app = await BnestFactory.create(AppModule);
const port = Number(Bun.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}\`);
});
`,
  );

  console.log(`\nProject ${name} created successfully.`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${name}`);
  console.log(`  bun install`);
  console.log(`  bun run dev\n`);
}
