export type BuildKind = "aot" | "binary" | "bundle";

export interface BuildOptions {
  /** Application entry point, e.g. `src/main.ts`. */
  entry: string;
  /** Output file. Defaults to `dist/app` for binaries and `dist/app.bun` for bundles. */
  out?: string;
  /** Cross-compilation target for `bun build --compile`; incompatible with AOT. */
  target?: string;
  /** Build a standalone binary. Implied by `aot` and by the absence of `target`. */
  compile?: boolean;
  /** Compile to machine code ahead of time with `bun compile`. */
  aot?: boolean;
  /** Remove unused Bun/Node APIs. Requires `aot`. */
  trim?: boolean;
  /** AOT slow-path report. `true` prints the default report. Requires `aot`. */
  explain?: string | true;
  /** Allow dynamic imports/workers to load code from disk. Requires `aot`. */
  allowCodeFromDisk?: boolean;
  /** Add AOT runtime hardening checks. Requires `aot`. */
  aotHarden?: string;
  /** Embed bytecode. Ignored with `aot`; implies `--format=esm` for binaries. */
  bytecode?: boolean;
  minify?: boolean;
  sourcemap?: boolean;
  /** Repeated `--asset` values. */
  assets?: string[];
  /** Repeated `--define` values. */
  defines?: string[];
  /** Write a JSON build manifest (BOM) next to the artifact. */
  manifest?: string;
}

export interface BuildPlan {
  command: string[];
  outFile: string;
  kind: BuildKind;
  warnings: string[];
}

export interface AotProbeResult {
  exitCode: number | null;
  stdout: Uint8Array | string;
  stderr: Uint8Array | string;
}

export type AotProbe = (command: string[]) => AotProbeResult;

/**
 * Build the command line without running it. Kept pure so the CLI contract is
 * testable without compiling real executables.
 */
export function buildPlan(options: BuildOptions, bunPath = process.execPath): BuildPlan {
  const aot = options.aot === true;
  const compile = aot || options.compile === true;

  if (aot && options.target) {
    throw new Error(
      "AOT cannot cross-compile. Build on the target platform or use a JIT binary (omit --aot).",
    );
  }
  if (!aot && options.trim) {
    throw new Error("--trim requires --aot. Use --aot --trim on a Bun build with AOT support.");
  }
  if (!aot && options.explain !== undefined) {
    throw new Error("--explain requires --aot.");
  }
  if (!aot && options.allowCodeFromDisk) {
    throw new Error("--aot-allow-code-from-disk requires --aot.");
  }
  if (!aot && options.aotHarden) {
    throw new Error("--aot-harden requires --aot.");
  }
  if (!compile && options.bytecode) {
    throw new Error("--bytecode requires a standalone binary; remove --target or use --aot.");
  }

  const outFile = options.out ?? (compile ? "dist/app" : "dist/app.bun");
  const command = [bunPath, aot ? "compile" : "build"];
  const warnings: string[] = [];

  if (aot) {
    // Never let a project-level "compile" script hijack the Bun AOT command.
    command.push("--no-script");
  } else {
    if (compile) command.push("--compile");
    if (options.target) command.push(`--target=${options.target}`);
    else if (!compile) command.push("--target=bun");
  }

  command.push(`--outfile=${outFile}`);

  // Production JIT binaries are minified and keep a source map by default.
  // AOT already reports source positions; only an explicit external map helps.
  if (options.minify ?? compile) command.push("--minify");
  if (options.sourcemap ?? (compile && !aot)) {
    command.push(aot ? "--sourcemap=external" : "--sourcemap");
  }

  if (options.bytecode) {
    if (aot) {
      warnings.push("--bytecode has no effect with --aot; ignoring it.");
    } else {
      // Bun defaults bytecode output to CommonJS; ESM (required by many Bun
      // apps with top-level await) needs an explicit format.
      command.push("--bytecode", "--format=esm");
    }
  }

  if (aot) {
    if (options.trim) command.push("--trim");
    if (options.explain === true) command.push("--explain");
    else if (options.explain) command.push(`--explain=${options.explain}`);
    if (options.allowCodeFromDisk) command.push("--aot-allow-code-from-disk");
    if (options.aotHarden) command.push(`--aot-harden=${options.aotHarden}`);
  }

  for (const asset of options.assets ?? []) command.push(`--asset=${asset}`);
  for (const define of options.defines ?? []) command.push(`--define=${define}`);

  command.push(options.entry);

  return {
    command,
    outFile,
    kind: aot ? "aot" : compile ? "binary" : "bundle",
    warnings,
  };
}

const defaultProbe: AotProbe = (command) => {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
};

function probeText(value: Uint8Array | string): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

/**
 * `bun build --compile --aot` is silently accepted by Bun 1.4.4 but does not
 * enable AOT. Detect the `bun compile` command instead of relying on
 * `Bun.version`, which also reports `1.4.4` for canary builds.
 */
export function detectAotSupport(
  bunPath = process.execPath,
  probe: AotProbe = defaultProbe,
): boolean {
  const result = probe([bunPath, "compile", "--no-script", "--help"]);
  if (result.exitCode !== 0) return false;
  const output = `${probeText(result.stdout)}\n${probeText(result.stderr)}`;
  return output.includes("Usage: bun compile") || /ahead of time/i.test(output);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "unknown size";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export interface BuildManifest {
  schemaVersion: 1;
  createdAt: string;
  entry: string;
  output: string;
  kind: BuildKind;
  target: string;
  bun: { version: string; revision?: string };
  flags: {
    aot: boolean;
    trim: boolean;
    bytecode: boolean;
    minify: boolean;
    sourcemap: boolean;
  };
  sizeBytes: number;
}

function currentTarget(): string {
  return `bun-${process.platform}-${process.arch}`;
}

/** Run a build, print its result and optionally write the BOM manifest. */
export async function runBuild(options: BuildOptions): Promise<void> {
  const plan = buildPlan(options);
  for (const warning of plan.warnings) console.warn(`⚠ ${warning}`);

  console.log(`Building ${options.entry} with Bun ${Bun.version} (${plan.kind})...`);
  const proc = Bun.spawn(plan.command, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`✗ Build failed with exit code ${exitCode}`);
    process.exit(exitCode ?? 1);
  }

  const file = Bun.file(plan.outFile);
  const sizeBytes = (await file.exists()) ? file.size : 0;
  console.log(`✓ Build complete: ${plan.outFile} (${plan.kind}, ${formatBytes(sizeBytes)})`);

  if (options.manifest) {
    const manifest: BuildManifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      entry: options.entry,
      output: plan.outFile,
      kind: plan.kind,
      target: options.target ?? currentTarget(),
      bun: {
        version: Bun.version,
        revision: (Bun as { revision?: string }).revision,
      },
      flags: {
        aot: plan.kind === "aot",
        trim: options.trim === true,
        bytecode: options.bytecode === true && plan.kind !== "aot",
        minify: options.minify ?? plan.kind !== "bundle",
        sourcemap: options.sourcemap ?? plan.kind === "binary",
      },
      sizeBytes,
    };
    await Bun.write(options.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`  manifest: ${options.manifest}`);
  }
}
