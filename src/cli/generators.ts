import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateDockerfile } from "./deployment";

export { generateDockerfile } from "./deployment";
export { generateCommand } from "./legacy-generators";
export type { DockerfileOptions } from "./deployment";

function names(name: string) {
  if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(name)) {
    throw new Error("Use a name beginning with a letter, followed by letters, numbers or hyphens.");
  }
  const pascal = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return { pascal, camel: pascal.charAt(0).toLowerCase() + pascal.slice(1) };
}

async function write(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${content.trimEnd()}\n`, { flag: "wx" });
  console.log(`CREATE ${path.relative(process.cwd(), file)}`);
}

async function json(file: string, value: unknown) {
  await write(file, JSON.stringify(value, null, 2));
}

export async function generateFeature(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.feature.ts`),
    `import { createApp } from "@kaonashi-dev/techne";

// Add dependencies as typed arguments; return the chain to retain route types.
export function ${camel}Feature() {
  return createApp({ prefix: "/${name}" }).get("/", () => ({ feature: "${name}" }));
}
`,
  );
}

export async function generateRoutes(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.routes.ts`),
    `import { createApp, t } from "@kaonashi-dev/techne";

export function ${camel}Routes() {
  return createApp({ prefix: "/${name}" })
    .get("/", () => [])
    .get(
      "/:id",
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
      },
      ({ params }) => ({ id: params.id }),
    );
}
`,
  );
}

export async function generateService(name: string, dir = ".") {
  const { pascal } = names(name);
  await write(
    path.join(dir, `${name}.service.ts`),
    `// Keep business logic independent of the HTTP framework.
export function create${pascal}Service() {
  return {
    findAll() {
      return [];
    },
  };
}

export type ${pascal}Service = ReturnType<typeof create${pascal}Service>;
`,
  );
}

export async function generateMiddleware(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.middleware.ts`),
    `import type { Context } from "@kaonashi-dev/techne";

// Register explicitly: app.beforeHandle(${camel}Middleware).
export function ${camel}Middleware({ request }: Context) {
  // Add request policy here. Return a response to stop the request.
}
`,
  );
}

export async function generateGuard(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.guard.ts`),
    `import { problem, type Context } from "@kaonashi-dev/techne";

// Supply the real authorization policy at the composition root.
export function ${camel}Guard(authorize: (request: Request) => boolean | Promise<boolean>) {
  return async ({ request }: Context) => {
    if (!(await authorize(request))) return problem(403, { detail: "Access denied" });
  };
}
`,
  );
}

export async function generateFilter(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.filter.ts`),
    `import { createApp } from "@kaonashi-dev/techne";

// Register before the routes it observes with app.use(${camel}Errors()).
export function ${camel}Errors() {
  return createApp({ name: "${name}-errors", as: "global" }).error(({ error }) => {
    console.error(error);
    // Return a response to map a domain error; otherwise Elysia handles it.
  });
}
`,
  );
}

export async function generateHook(name: string, dir = ".") {
  const { camel } = names(name);
  await write(
    path.join(dir, `${name}.hook.ts`),
    `import { createApp } from "@kaonashi-dev/techne";

export function ${camel}Hook() {
  return createApp({ name: "${name}-hook", as: "global" }).afterHandle(({ set }) => {
    set.headers["x-${name}"] = "true";
  });
}
`,
  );
}

export async function generateSchema(name: string, dir = ".") {
  const { pascal } = names(name);
  await write(
    path.join(dir, `${name}.schema.ts`),
    `import { t } from "@kaonashi-dev/techne";

export const ${pascal}Schema = t.Object({
  name: t.String({ minLength: 1 }),
});
`,
  );
}

export async function generateResource(name: string) {
  const { camel, pascal } = names(name);
  const dir = path.join(process.cwd(), "src", "features", name);
  await generateService(name, dir);
  await write(
    path.join(dir, `${name}.routes.ts`),
    `import { createApp } from "@kaonashi-dev/techne";
import type { ${pascal}Service } from "./${name}.service";

export function ${camel}Routes(service: ${pascal}Service) {
  return createApp({ prefix: "/${name}" }).get("/", () => service.findAll());
}
`,
  );
  await write(
    path.join(dir, `${name}.feature.ts`),
    `import { create${pascal}Service } from "./${name}.service";
import { ${camel}Routes } from "./${name}.routes";

export function ${camel}Feature() {
  const service = create${pascal}Service();
  return ${camel}Routes(service);
}
`,
  );
}

export async function createProject(name: string) {
  names(name);
  const dir = path.join(process.cwd(), name);
  try {
    if ((await fs.readdir(dir)).length > 0) {
      throw new Error(`Target directory "${name}" already exists and is not empty.`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await json(path.join(dir, "package.json"), {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    scripts: {
      dev: "techne dev",
      start: "techne start",
      build: "techne build",
      "build:bundle": "techne build --target=bun --minify",
      "deploy:docker": "techne deploy --target docker",
      test: "bun test",
      typecheck: "tsc --noEmit",
      lint: "oxlint .",
      format: "oxfmt .",
      "format:check": "oxfmt --check .",
      check: "bun run typecheck && bun run lint && bun run format:check",
    },
    dependencies: { "@kaonashi-dev/techne": "github:kaonashi-dev/techne" },
    devDependencies: {
      "@types/bun": "^1.3.11",
      typescript: "^5.9.3",
      oxlint: "^1.56.0",
      oxfmt: "^0.41.0",
    },
  });
  await json(path.join(dir, "tsconfig.json"), {
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["bun"],
    },
    include: ["src/**/*.ts", "tests/**/*.ts"],
  });
  await json(path.join(dir, "oxlint.json"), {
    plugins: ["typescript"],
    ignorePatterns: ["dist/", "node_modules/"],
  });
  await json(path.join(dir, ".oxfmtrc.json"), {
    ignorePatterns: ["*.md", "*.json", ".*.json"],
  });
  await write(path.join(dir, ".gitignore"), "node_modules\ndist\ncoverage\n.env\n.DS_Store");
  await write(path.join(dir, ".env.example"), "PORT=3000\nHOST=0.0.0.0");
  await write(
    path.join(dir, "src", "features", "greeting", "greeting.service.ts"),
    `export function createGreetingService(message: string) {
  return { greet: () => ({ message }) };
}

export type GreetingService = ReturnType<typeof createGreetingService>;
`,
  );
  await write(
    path.join(dir, "src", "features", "greeting", "greeting.routes.ts"),
    `import { createApp } from "@kaonashi-dev/techne";
import type { GreetingService } from "./greeting.service";

export function greetingRoutes(service: GreetingService) {
  return createApp().get("/", () => service.greet());
}
`,
  );
  await write(
    path.join(dir, "src", "app.ts"),
    `import { createApp } from "@kaonashi-dev/techne";
import { createGreetingService } from "./features/greeting/greeting.service";
import { greetingRoutes } from "./features/greeting/greeting.routes";

export function buildApp(message = "Hello from Techne!") {
  const greeting = createGreetingService(message);
  return createApp()
    .get("/healthz", () => ({ healthy: true }))
    .use(greetingRoutes(greeting));
}

export type App = ReturnType<typeof buildApp>;
`,
  );
  await write(
    path.join(dir, "src", "main.ts"),
    `import { buildApp } from "./app";

const app = buildApp().listen({
  port: Number(Bun.env.PORT ?? 3000),
  hostname: Bun.env.HOST ?? "0.0.0.0",
});

let stopping: Promise<unknown> | undefined;
const stop = () => (stopping ??= Promise.resolve(app.stop()));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
`,
  );
  await write(
    path.join(dir, "tests", "app.test.ts"),
    `import { expect, test } from "bun:test";
import { buildApp } from "../src/app";

test("greets through the HTTP boundary", async () => {
  const app = buildApp("Hello test");
  const response = await app.handle(new Request("http://localhost/"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: "Hello test" });
});
`,
  );
  await write(
    path.join(dir, "README.md"),
    `# ${name}

Run \`bun install\`, then \`bun run dev\`. Verify with \`bun test\` and \`bun run check\`.

- \`src/app.ts\` composes services and native Elysia feature plugins.
- \`src/main.ts\` owns environment configuration and the HTTP server.
- \`src/features/<name>/\` keeps routes and business logic together.
- Dependencies are ordinary function arguments. Tests pass fakes directly.
- Return the Elysia chain from route factories to preserve inferred API types.

Generate a feature with \`bunx techne g resource users\`, then import and mount it
explicitly in \`src/app.ts\`. Build with \`bun run build\` or \`bun run build:bundle\`.
`,
  );
  await generateDockerfile({ outDir: dir });
  console.log(`\nProject ${name} created. Run bun install and bun run dev inside ${name}.`);
}
