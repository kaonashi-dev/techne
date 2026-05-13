#!/usr/bin/env bun

console.warn("[bnest] The `bnest` CLI is deprecated; use `techne` instead.");

const proc = Bun.spawn(["techne", ...process.argv.slice(2)], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);
