#!/usr/bin/env bun
import * as path from "path";
import {
  generateController,
  generateModule,
  generateService,
  generateResource,
  generateMiddleware,
  generateGuard,
  generateFilter,
  generateDto,
  generateHook,
  generateDockerfile,
  createProject,
} from "./generators";

const args = process.argv.slice(2);
const command = args[0];

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
};

function ok(msg: string) {
  console.log(`${ANSI.green}✓${ANSI.reset} ${msg}`);
}
function warn(msg: string) {
  console.log(`${ANSI.yellow}⚠${ANSI.reset} ${msg}`);
}
function fail(msg: string) {
  console.log(`${ANSI.red}✗${ANSI.reset} ${msg}`);
}

function flag(name: string): boolean {
  return args.includes(name);
}

function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1 || i === args.length - 1) return undefined;
  return args[i + 1];
}

function positionalArgAfterCommand(defaultValue: string): string {
  const valueFlags = new Set(["--out", "--target", "--port", "--bun-version"]);
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith("--")) continue;
    return arg;
  }
  return defaultValue;
}

async function buildApp(
  entry: string,
  options: { out?: string; target?: string; minify?: boolean; compile?: boolean },
) {
  const compile = options.compile ?? false;
  const outFile = options.out ?? (compile ? "dist/app" : "dist/app.bun");
  const minify = options.minify ?? false;

  const bunArgs = ["bun", "build"];
  if (compile) {
    bunArgs.push("--compile");
  } else {
    bunArgs.push(`--target=${options.target ?? "bun"}`);
  }
  bunArgs.push(`--outfile=${outFile}`);
  if (minify) bunArgs.push("--minify");
  bunArgs.push(entry);

  console.log(`Building ${entry}...`);
  const proc = Bun.spawn(bunArgs, { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    ok(`Build complete: ${outFile}${compile ? " (standalone binary)" : ""}`);
  } else {
    fail(`Build failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

async function runEntry(opts: { hot: boolean; inspect: boolean; port?: string; entry?: string }) {
  const entry = opts.entry ?? "src/main.ts";
  const bunArgs: string[] = ["bun"];
  if (opts.hot) bunArgs.push("--hot");
  if (opts.inspect) bunArgs.push("--inspect");
  bunArgs.push("run", entry);

  const env: Record<string, string> = { ...Bun.env } as Record<string, string>;
  if (opts.port) env.PORT = opts.port;

  const proc = Bun.spawn(bunArgs, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env,
  });
  const exitCode = await proc.exited;
  process.exit(exitCode ?? 0);
}

async function runTests(pattern: string | undefined, watch: boolean, coverage: boolean) {
  const testArgs: string[] = ["bun", "test"];
  if (pattern) testArgs.push(pattern);
  if (watch) testArgs.push("--watch");
  if (coverage) testArgs.push("--coverage");

  const proc = Bun.spawn(testArgs, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  process.exit(exitCode ?? 0);
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return undefined;
  try {
    const text = await file.text();
    // strip trailing commas and // comments for tolerant parsing
    const cleaned = text
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned);
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  return Bun.file(filePath).exists();
}

async function doctor() {
  let hasError = false;

  console.log(`${ANSI.dim}Techne doctor${ANSI.reset}\n`);

  // Bun version
  ok(`Bun ${Bun.version}`);

  // tsconfig.json
  const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
  if (await exists(tsconfigPath)) {
    const tsconfig = (await readJsonIfExists(tsconfigPath)) as
      | { compilerOptions?: { experimentalDecorators?: boolean; emitDecoratorMetadata?: boolean } }
      | undefined;
    if (!tsconfig) {
      warn(`tsconfig.json present but could not be parsed`);
    } else {
      ok(`tsconfig.json present`);
      const opts = tsconfig.compilerOptions ?? {};
      if (opts.experimentalDecorators === true) {
        ok(`tsconfig: experimentalDecorators enabled`);
      } else {
        fail(`tsconfig: experimentalDecorators is NOT enabled`);
        hasError = true;
      }
      if (opts.emitDecoratorMetadata === true) {
        ok(`tsconfig: emitDecoratorMetadata enabled`);
      } else {
        fail(`tsconfig: emitDecoratorMetadata is NOT enabled`);
        hasError = true;
      }
    }
  } else {
    fail(`tsconfig.json missing`);
    hasError = true;
  }

  // src/main.ts
  if (await exists(path.join(process.cwd(), "src/main.ts"))) {
    ok(`src/main.ts present`);
  } else {
    fail(`src/main.ts missing`);
    hasError = true;
  }

  // techne.config.ts (informational; legacy bnest.config.ts also recognized)
  if (await exists(path.join(process.cwd(), "techne.config.ts"))) {
    ok(`techne.config.ts present`);
  } else if (await exists(path.join(process.cwd(), "bnest.config.ts"))) {
    warn(`bnest.config.ts present (deprecated — rename to techne.config.ts)`);
  } else {
    warn(`techne.config.ts not found (optional)`);
  }

  // .env
  if (await exists(path.join(process.cwd(), ".env"))) {
    ok(`.env present`);
  } else {
    warn(`.env not found`);
  }

  // .env.example
  if (await exists(path.join(process.cwd(), ".env.example"))) {
    ok(`.env.example present`);
  } else {
    warn(`.env.example not found`);
  }

  process.exit(hasError ? 1 : 0);
}

function printHelp() {
  console.log(`
Techne CLI

Usage:
  techne new <project-name>
  techne dev [--port N] [--inspect]
  techne start [--port N]
  techne test [pattern] [--watch] [--coverage]
  techne build|b [entry] [--out <file>] [--minify] [--precompile]          (standalone binary, default)
  techne build|b [entry] --target <bun|node|browser> [--out <file>] [--minify] [--precompile]  (JS bundle)
  techne deploy --target docker [--out Dockerfile] [--port N] [--bun-version V] [--dry-run] [--force]
  techne doctor
  techne generate|g <type> <name>

Available generators:
  module
  controller
  service
  resource
  middleware
  guard
  filter
  hook
  dto
  docker          (writes Dockerfile + .dockerignore; supports --port, --bun-version, --out, --force, --dry-run)
  client          (writes a typed RPC route map; supports --out, defaults to src/routes.generated.ts)

Build modes:
  (default)        Standalone binary via bun build --compile. Output: dist/app. No runtime needed on server.
  --target=bun     JS bundle that runs with Bun. Output: dist/app.bun.
  --target=node    JS bundle (ESM) for Node.js.
  --target=browser JS bundle for the browser.

Build flags:
  --precompile  Writes .techne/routes.json from techne.config.ts before building (AOT route optimization).

Deploy targets:
  docker   Multi-stage Bun Dockerfile (only target supported for now)
           Planned: fly, railway, cloudflare, bun-vm
  `);
}

async function runGenerateClient() {
  const out = flagValue("--out") ?? "src/routes.generated.ts";
  const cwd = process.cwd();

  // Find a techne.config.{ts,js,mjs} so we know how to boot the user's app.
  // Falls back to the deprecated bnest.config.* name through v0.4.x.
  const CANDIDATES = [
    "techne.config.ts",
    "techne.config.js",
    "techne.config.mjs",
    "bnest.config.ts",
    "bnest.config.js",
    "bnest.config.mjs",
  ];
  let configPath: string | undefined;
  for (const name of CANDIDATES) {
    const candidate = path.join(cwd, name);
    if (await exists(candidate)) {
      configPath = candidate;
      break;
    }
  }
  if (!configPath) {
    fail(
      `techne.config.ts not found in ${cwd}. Create one with \`export default defineTechneConfig({ controllers: [...] })\` and re-run.`,
    );
    process.exit(1);
  }

  try {
    const cfgMod = await import(configPath);
    const config = cfgMod?.default;
    if (!config) {
      fail(`techne.config.ts must export a default flat app config.`);
      process.exit(1);
    }

    // Lazy-import to keep CLI startup fast for unrelated commands.
    const { TechneFactory } = await import("../factory/techne-factory");
    const { generateRoutesType } = await import("../contract/codegen");

    const app = await TechneFactory.create({ ...config, logger: false });
    const source = generateRoutesType(app);

    const outPath = path.isAbsolute(out) ? out : path.join(cwd, out);
    await Bun.write(outPath, source);
    ok(`Wrote ${path.relative(cwd, outPath)}`);

    // Make sure we don't keep the event loop alive after the CLI returns.
    await app.close();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`generate client failed: ${message}`);
    process.exit(1);
  }
}

async function runDeploy() {
  const target = flagValue("--target");
  if (!target || target !== "docker") {
    console.error(
      `techne deploy: only --target docker is supported for now (planned: fly, railway, cloudflare, bun-vm)`,
    );
    process.exit(1);
  }
  await runDockerGenerate({ requireTarget: false });
}

async function runDockerGenerate(_opts: { requireTarget: boolean }) {
  const out = flagValue("--out") ?? "Dockerfile";
  const portRaw = flagValue("--port");
  const port = portRaw ? Number(portRaw) : 3000;
  if (!Number.isFinite(port) || port <= 0) {
    console.error(`techne: invalid --port value "${portRaw}"`);
    process.exit(1);
  }
  const bunVersion = flagValue("--bun-version") ?? "1";
  const dryRun = flag("--dry-run");
  const force = flag("--force");

  try {
    const result = await generateDockerfile({
      outDir: process.cwd(),
      port,
      bunVersion,
      outName: out,
      force,
      dryRun,
      writeDockerignore: true,
    });

    if (dryRun) {
      console.log(result.dockerfile);
      if (result.dockerignore) {
        console.log(`# --- .dockerignore ---`);
        console.log(result.dockerignore);
      }
      return;
    }

    console.log(`\nNext steps:`);
    console.log(`  docker build -t app .`);
    console.log(`  docker run -p ${port}:${port} app`);
    console.log(`  docker compose up\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`techne: ${message}`);
    process.exit(1);
  }
}

async function main() {
  if (command === "new") {
    const projectName = args[1];
    if (!projectName) {
      console.error("Please specify a project name: techne new <project-name>");
      process.exit(1);
    }
    await createProject(projectName);
  } else if (command === "dev") {
    await runEntry({
      hot: true,
      inspect: flag("--inspect"),
      port: flagValue("--port"),
    });
  } else if (command === "start") {
    await runEntry({
      hot: false,
      inspect: false,
      port: flagValue("--port"),
    });
  } else if (command === "test") {
    const watch = flag("--watch");
    const coverage = flag("--coverage");
    // first positional arg after "test" that isn't a flag
    let pattern: string | undefined;
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (a === "--watch" || a === "--coverage") continue;
      pattern = a;
      break;
    }
    if (!pattern) pattern = "tests/";
    await runTests(pattern, watch, coverage);
  } else if (command === "doctor") {
    await doctor();
  } else if (command === "deploy") {
    await runDeploy();
  } else if (command === "generate" || command === "g") {
    const type = args[1];

    if (!type) {
      console.error("Usage: techne generate <type> <name>");
      process.exit(1);
    }

    if (type === "docker") {
      await runDockerGenerate({ requireTarget: false });
      return;
    }

    if (type === "client") {
      await runGenerateClient();
      return;
    }

    const name = args[2];
    if (!name) {
      console.error("Usage: techne generate <type> <name>");
      process.exit(1);
    }

    switch (type) {
      case "module":
        await generateModule(name);
        break;
      case "controller":
        await generateController(name);
        break;
      case "service":
        await generateService(name);
        break;
      case "resource":
        await generateResource(name);
        break;
      case "middleware":
        await generateMiddleware(name);
        break;
      case "guard":
        await generateGuard(name);
        break;
      case "filter":
        await generateFilter(name);
        break;
      case "hook":
        await generateHook(name);
        break;
      case "dto":
        await generateDto(name);
        break;
      default:
        console.error(`Unknown generator type: ${type}`);
        process.exit(1);
    }
  } else if (command === "build" || command === "b") {
    if (flag("--precompile")) {
      const { precompileRoutes } = await import("./precompile");
      const result = await precompileRoutes(process.cwd());
      ok(`Precompiled ${result.routes} route(s) to ${path.relative(process.cwd(), result.path)}`);
    }

    const entry = positionalArgAfterCommand("src/main.ts");
    const out = flagValue("--out");
    const target = flagValue("--target");
    const minify = flag("--minify");
    // --compile is the default when no --target is given
    const compile = !target || flag("--compile");

    if (flag("--compile") && target) {
      warn("--target is ignored when --compile is set (Bun standalone binaries are always bun-target)");
    }

    const ext = path.extname(entry);
    const outDefault = compile ? "dist/app" : (ext === ".ts" ? "dist/app.bun" : entry.replace(ext, ".bun"));

    await buildApp(entry, {
      out: out ?? outDefault,
      target,
      minify,
      compile,
    });
  } else {
    printHelp();
  }
}

main().catch(console.error);
