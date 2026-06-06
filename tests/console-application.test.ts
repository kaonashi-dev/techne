import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { BufferedConsole } from "../src/console/buffered-console";
import { ConsoleCommand } from "../src/console/decorators/console-command.decorator";
import { Argument, Option } from "../src/console/decorators/argument.decorator";
import { Console } from "../src/console/console.service";
import { ExitCode } from "../src/console/exit-code";
import { Injectable } from "../src/decorators/injectable.decorator";

async function boot(providers: any[]) {
  const buffered = new BufferedConsole();
  const app = await TechneFactory.createConsoleApplication(
    { providers, logger: false },
    { console: buffered },
  );
  return { app, buffered };
}

describe("ConsoleApplication", () => {
  test("runs a simple command and returns SUCCESS", async () => {
    @Injectable()
    class GreetCommand {
      constructor(private readonly console: Console) {}

      @ConsoleCommand("greet", { description: "Greet someone" })
      handle(@Argument("name") name: string) {
        this.console.success(`Hello, ${name}!`);
      }
    }

    const { app, buffered } = await boot([GreetCommand]);
    const code = await app.run("greet", ["World"]);
    await app.close();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(buffered.out).toContain("Hello, World!");
  });

  test("void return normalizes to SUCCESS (0)", async () => {
    @Injectable()
    class NopCommand {
      @ConsoleCommand("nop")
      handle() {}
    }

    const { app } = await boot([NopCommand]);
    expect(await app.run("nop", [])).toBe(0);
    await app.close();
  });

  test("ExitCode.ERROR return propagates", async () => {
    @Injectable()
    class FailCmd {
      @ConsoleCommand("fail")
      handle() {
        return ExitCode.ERROR;
      }
    }

    const { app } = await boot([FailCmd]);
    expect(await app.run("fail", [])).toBe(1);
    await app.close();
  });

  test("thrown error returns ERROR (1)", async () => {
    @Injectable()
    class BoomCmd {
      @ConsoleCommand("boom")
      handle() {
        throw new Error("kaboom");
      }
    }

    const { app, buffered } = await boot([BoomCmd]);
    const code = await app.run("boom", []);
    await app.close();

    expect(code).toBe(ExitCode.ERROR);
    expect(buffered.err).toContain("kaboom");
  });

  test("missing required argument returns INVALID (2)", async () => {
    @Injectable()
    class NeedArgCmd {
      @ConsoleCommand("need-arg")
      handle(@Argument("x") _x: string) {}
    }

    const { app } = await boot([NeedArgCmd]);
    expect(await app.run("need-arg", [])).toBe(ExitCode.INVALID);
    await app.close();
  });

  test("unknown command returns INVALID (2)", async () => {
    const { app } = await boot([]);
    expect(await app.run("nope", [])).toBe(ExitCode.INVALID);
    await app.close();
  });

  test("--help prints usage and returns SUCCESS", async () => {
    @Injectable()
    class HelpCmd {
      @ConsoleCommand("helper", { description: "A helpful command" })
      handle(@Argument("name") _name: string, @Option("limit", { default: 10 }) _limit: number) {}
    }

    const { app, buffered } = await boot([HelpCmd]);
    const code = await app.run("helper", ["--help"]);
    await app.close();

    expect(code).toBe(ExitCode.SUCCESS);
    expect(buffered.out).toContain("helper");
    expect(buffered.out).toContain("--limit");
  });

  test("list outputs registered commands", async () => {
    @Injectable()
    class ListCmd {
      @ConsoleCommand("visible", { description: "visible command" })
      handle() {}
    }

    const { app, buffered } = await boot([ListCmd]);
    app.list();
    await app.close();

    expect(buffered.out).toContain("visible");
    expect(buffered.out).toContain("visible command");
  });

  test("injects Console service via constructor DI", async () => {
    @Injectable()
    class InjectConsoleCmd {
      constructor(private readonly con: Console) {}

      @ConsoleCommand("inject-test")
      handle() {
        this.con.writeln("injected!");
      }
    }

    const { app, buffered } = await boot([InjectConsoleCmd]);
    await app.run("inject-test", []);
    await app.close();

    expect(buffered.out).toContain("injected!");
  });

  test("option coercion works via run", async () => {
    @Injectable()
    class LimitCmd {
      @ConsoleCommand("limit-test")
      handle(@Option("count", { default: 0 }) count: number) {
        return count;
      }
    }

    const { app } = await boot([LimitCmd]);
    const code = await app.run("limit-test", ["--count=42"]);
    await app.close();

    expect(code).toBe(42);
  });
});
