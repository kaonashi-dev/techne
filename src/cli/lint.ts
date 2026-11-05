import * as os from "node:os";

/**
 * `bun lint` only ships in Bun canary builds. On stable Bun, `bun lint` is an
 * alias for `bun run lint`, so a `"lint": "bun lint"` script calls itself
 * forever. `techne lint` checks for the native linter first and fails with an
 * explanation instead.
 */
export async function hasNativeLint(): Promise<boolean> {
  // Run outside any project so a `lint` script can't answer for the builtin.
  const child = Bun.spawn([process.execPath, "lint", "--help"], {
    cwd: os.tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return stdout.includes("bun lint [flags]");
}

export const NATIVE_LINT_MISSING =
  "`bun lint` is not available in this Bun version. It currently ships in Bun canary " +
  "builds only: run `bun upgrade --canary`, or skip linting until it reaches a stable release.";

/** Runs the native `bun lint` with `args` and returns its exit code. */
export async function runLint(args: string[]): Promise<number> {
  if (!(await hasNativeLint())) {
    console.error(`techne: Bun ${Bun.version}: ${NATIVE_LINT_MISSING}`);
    return 1;
  }
  // `--no-script` skips the project's `lint` script, which usually calls `techne lint`.
  const child = Bun.spawn([process.execPath, "lint", "--no-script", ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  return child.exited;
}
