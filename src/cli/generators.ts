import * as fs from "fs/promises";
import * as path from "path";

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
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
  await fs.mkdir(dir, { recursive: true });

  const pkgJson = {
    name,
    version: "1.0.0",
    scripts: {
      start: "bun run src/main.ts",
      dev: "bun --hot run src/main.ts",
    },
    dependencies: {
      elysia: "^1.0.0",
      bnest: "latest",
      "reflect-metadata": "^0.13.0",
      "@sinclair/typebox": "^0.32.0",
    },
    devDependencies: {
      "bun-types": "latest",
      typescript: "^5.0.0",
    },
  };

  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkgJson, null, 2));
  console.log(`CREATE ${name}/package.json`);

  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      types: ["bun-types"],
    },
  };

  await fs.writeFile(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  console.log(`CREATE ${name}/tsconfig.json`);

  const srcDir = path.join(dir, "src");
  await fs.mkdir(srcDir, { recursive: true });

  await fs.writeFile(
    path.join(srcDir, "app.module.ts"),
    `import { Module } from 'bnest';

@Module({
  imports: [],
  controllers: [],
  providers: []
})
export class AppModule {}
`,
  );
  console.log(`CREATE ${name}/src/app.module.ts`);

  await fs.writeFile(
    path.join(srcDir, "main.ts"),
    `import { BnestFactory } from 'bnest';
import { AppModule } from './app.module';

const app = BnestFactory.create(AppModule);

app.listen(5775, () => {
  console.log(\`🦊 Server running at http://\${app.server?.hostname}:\${app.server?.port}\`);
});
`,
  );
  console.log(`CREATE ${name}/src/main.ts`);

  console.log(`\nProject ${name} created successfully!`);
  console.log(`\ncd ${name}\nbun install\nbun run dev\n`);
}
