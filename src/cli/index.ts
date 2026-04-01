#!/usr/bin/env bun
import * as path from "path";
import {
  generateController,
  generateModule,
  generateService,
  generateResource,
  createProject,
} from "./generators";

const args = process.argv.slice(2);
const command = args[0];

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

async function main() {
  if (command === "new") {
    const projectName = args[1];
    if (!projectName) {
      console.error("Please specify a project name: bnest new <project-name>");
      process.exit(1);
    }
    await createProject(projectName);
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
    console.log(`
Bnest CLI

Usage:
  bnest new <project-name>
  bnest generate|g <type> <name>
  bnest build|b [entry] [--out <file>] [--target <bun|node|browser>] [--minify]

Available generators:
  module
  controller
  service
  resource

Build targets:
  bun      Standalone Bun binary (default)
  node     Node.js ESM module
  browser  Browser bundle
    `);
  }
}

main().catch(console.error);
