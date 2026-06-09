/**
 * Tests for Phase 5: console @Options decorator validation.
 *
 * Covers:
 * - Valid @Options(DtoClass) with --env production → resolves correctly
 * - Invalid options (missing required field) → ConsoleArgumentError with message
 * - Type coercion: boolean flags coerced before validation
 * - Error format consistent with ConsoleArgumentError
 */
import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { ConsoleCommand } from "../src/console/decorators/console-command.decorator";
import { Options } from "../src/console/decorators/argument.decorator";
import { Console } from "../src/console/console.service";
import { Injectable } from "../src/decorators/injectable.decorator";
import { ConsoleArgumentError } from "../src/console/errors";
import { createConsoleTester } from "../src/console/testing";
import { Dto, IsString, IsBoolean, IsOptional, MinLength, IsNumber } from "../src/schema";

// ── Test DTO classes ──────────────────────────────────────────────────────────

@Dto()
class DeployOptions {
  @IsString()
  @MinLength(1)
  env!: string;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@Dto()
class BuildOptions {
  @IsString()
  @MinLength(1)
  target!: string;

  @IsOptional()
  @IsNumber()
  workers?: number;
}

// ── Commands using @Options ───────────────────────────────────────────────────

@Injectable()
class DeployCommand {
  constructor(private readonly console: Console) {}

  @ConsoleCommand("deploy", { description: "Deploy the app" })
  handle(@Options(DeployOptions) opts: DeployOptions) {
    this.console.success(`Deploying to ${opts.env}${opts.dryRun ? " (dry-run)" : ""}`);
  }
}

@Injectable()
class BuildCommand {
  constructor(private readonly console: Console) {}

  @ConsoleCommand("build", { description: "Build the app" })
  handle(@Options(BuildOptions) opts: BuildOptions) {
    const workers = opts.workers ?? 1;
    this.console.success(`Building for ${opts.target} with ${workers} workers`);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("@Options console decorator validation", () => {
  // ── Valid options ────────────────────────────────────────────────────────

  test("valid --env production resolves and executes command", async () => {
    const tester = await createConsoleTester({ providers: [DeployCommand] });
    const result = await tester.call("deploy", ["--env", "production"]);
    result.assertSuccess().assertSee("Deploying to production");
    await tester.close();
  });

  test("valid --env staging --dryRun true works", async () => {
    const tester = await createConsoleTester({ providers: [DeployCommand] });
    const result = await tester.call("deploy", ["--env", "staging", "--dryRun", "true"]);
    result.assertSuccess().assertSee("staging (dry-run)");
    await tester.close();
  });

  test("boolean flag coercion: --dryRun (no value) treated as true", async () => {
    const tester = await createConsoleTester({ providers: [DeployCommand] });
    const result = await tester.call("deploy", ["--env", "production", "--dryRun"]);
    result.assertSuccess().assertSee("dry-run");
    await tester.close();
  });

  // ── Type coercion ────────────────────────────────────────────────────────

  test("numeric option coercion: --workers 4 coerced to number", async () => {
    const tester = await createConsoleTester({ providers: [BuildCommand] });
    const result = await tester.call("build", ["--target", "linux", "--workers", "4"]);
    result.assertSuccess().assertSee("4 workers");
    await tester.close();
  });

  // ── Invalid options ──────────────────────────────────────────────────────

  test("missing required field --env → ConsoleArgumentError (exit code 2 = INVALID)", async () => {
    const tester = await createConsoleTester({ providers: [DeployCommand] });
    // Call with no arguments — missing required 'env' field
    const result = await tester.call("deploy", []);
    // ConsoleArgumentError produces ExitCode.INVALID = 2
    result.assertExitCode(2);
    await tester.close();
  });

  test("ConsoleArgumentError is thrown with descriptive message for missing required field", () => {
    // Unit-test the argument resolver directly
    const { resolveArguments } = require("../src/console/argument-resolver");
    const { parseArgv } = require("../src/console/argv-parser");

    const params: any[] = [
      {
        index: 0,
        kind: "options-bag",
        name: "__options_bag__",
        dtoClass: DeployOptions,
      },
    ];

    expect(() => resolveArguments(params, parseArgv([]))).toThrow(ConsoleArgumentError);
  });

  test("ConsoleArgumentError message is descriptive for minLength violation", () => {
    const { resolveArguments } = require("../src/console/argument-resolver");
    const { parseArgv } = require("../src/console/argv-parser");

    const params: any[] = [
      {
        index: 0,
        kind: "options-bag",
        name: "__options_bag__",
        dtoClass: DeployOptions,
      },
    ];

    // --env "" fails minLength(1)
    let caught: Error | undefined;
    try {
      resolveArguments(params, parseArgv(["--env", ""]));
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeInstanceOf(ConsoleArgumentError);
    expect(caught!.message.length).toBeGreaterThan(0);
  });

  // ── Options bag collects all flags ───────────────────────────────────────

  test("options bag collects all flags into plain object", () => {
    const { resolveArguments } = require("../src/console/argument-resolver");
    const { parseArgv } = require("../src/console/argv-parser");

    const params: any[] = [
      {
        index: 0,
        kind: "options-bag",
        name: "__options_bag__",
        dtoClass: DeployOptions,
      },
    ];

    const [result] = resolveArguments(params, parseArgv(["--env", "production"]));
    expect(result).toMatchObject({ env: "production" });
  });
});
