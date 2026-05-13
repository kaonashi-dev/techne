#!/usr/bin/env bun
import * as path from "path";
import {
  generateController,
  generateModule,
  generateService,
  generateResource,
  generateMiddleware,
  generateGuard,
  generatePipe,
  generateFilter,
  generateInterceptor,
  generateDto,
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

async function buildApp(
  entry: string,
  options: { out?: string; target?: string; minify?: boolean },
) {
  const outFile = options.out ?? "dist/app.bun";
  const target = options.target ?? "bun";
  const minify = options.minify ?? false;

  const minifyFlag = minify ? "--minify" : "";
  const cmd = `bun build ${entry} --target=${target} --outfile=${outFile} ${minifyFlag}`.trim();

  console.log(`Building ${entry}...`);
  const proc = Bun.spawn(cmd.split(" "), { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    console.log(`Build complete: ${outFile}`);
  } else {
    console.error(`Build failed with exit code ${exitCode}`);
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

  console.log(`${ANSI.dim}Bnest doctor${ANSI.reset}\n`);

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

  // bnest.config.ts (informational)
  if (await exists(path.join(process.cwd(), "bnest.config.ts"))) {
    ok(`bnest.config.ts present`);
  } else {
    warn(`bnest.config.ts not found (optional)`);
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
Bnest CLI

Usage:
  bnest new <project-name>
  bnest dev [--port N] [--inspect]
  bnest start [--port N]
  bnest test [pattern] [--watch] [--coverage]
  bnest build|b [entry] [--out <file>] [--target <bun|node|browser>] [--minify]
  bnest doctor
  bnest generate|g <type> <name>

Available generators:
  module
  controller
  service
  resource
  middleware
  guard
  pipe
  filter
  interceptor
  dto

Build targets:
  bun      Standalone Bun binary (default)
  node     Node.js ESM module
  browser  Browser bundle
  `);
}

async function main() {
  if (command === "new") {
    const projectName = args[1];
    if (!projectName) {
      console.error("Please specify a project name: bnest new <project-name>");
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
  } else if (command === "generate" || command === "g") {
    const type = args[1];
    const name = args[2];

    if (!type || !name) {
      console.error("Usage: bnest generate <type> <name>");
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
      case "pipe":
        await generatePipe(name);
        break;
      case "filter":
        await generateFilter(name);
        break;
      case "interceptor":
        await generateInterceptor(name);
        break;
      case "dto":
        await generateDto(name);
        break;
      default:
        console.error(`Unknown generator type: ${type}`);
        process.exit(1);
    }
  } else if (command === "build" || command === "b") {
    const entry = args[1] ?? "src/main.ts";
    const outIndex = args.indexOf("--out");
    const targetIndex = args.indexOf("--target");
    const minifyIndex = args.indexOf("--minify");

    const out = outIndex !== -1 ? args[outIndex + 1] : undefined;
    const target = targetIndex !== -1 ? args[targetIndex + 1] : undefined;
    const minify = minifyIndex !== -1;

    const ext = path.extname(entry);
    const outDefault = ext === ".ts" ? "dist/app.bun" : entry.replace(ext, ".bun");

    await buildApp(entry, {
      out: out ?? outDefault,
      target: target ?? "bun",
      minify,
    });
  } else {
    printHelp();
  }
}

main().catch(console.error);
