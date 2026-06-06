import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { ConsoleCommand } from "../src/console/decorators/console-command.decorator";
import { Argument } from "../src/console/decorators/argument.decorator";
import { ConsoleRegistry } from "../src/console/console-registry";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Container } from "../src/core/container";
import { Scanner } from "../src/core/scanner";

function makeContainer(...classes: any[]): Container {
  const container = new Container();
  const scanner = new Scanner({ logger: false, container });
  scanner.scanFlat({ providers: classes });
  for (const cls of classes) container.get(cls);
  return container;
}

describe("ConsoleRegistry", () => {
  test("registers a command and finds it by name", () => {
    @Injectable()
    class GreetCommand {
      @ConsoleCommand("greet", { description: "Greet someone" })
      handle(@Argument("name") _name: string) {}
    }

    const container = makeContainer(GreetCommand);
    const registry = new ConsoleRegistry(container);
    registry.registerFromClasses([GreetCommand]);

    const entry = registry.find("greet");
    expect(entry).toBeDefined();
    expect(entry!.name).toBe("greet");
    expect(entry!.methodName).toBe("handle");
    expect(entry!.params).toHaveLength(1);
  });

  test("alias resolution", () => {
    @Injectable()
    class DbSeedCommand {
      @ConsoleCommand("db:seed", { aliases: ["seed"] })
      handle() {}
    }

    const container = makeContainer(DbSeedCommand);
    const registry = new ConsoleRegistry(container);
    registry.registerFromClasses([DbSeedCommand]);

    expect(registry.find("seed")?.name).toBe("db:seed");
    expect(registry.find("db:seed")?.name).toBe("db:seed");
  });

  test("list excludes hidden commands", () => {
    @Injectable()
    class HiddenCommand {
      @ConsoleCommand("hidden", { hidden: true })
      handle() {}
    }
    @Injectable()
    class VisibleCommand {
      @ConsoleCommand("visible")
      handle() {}
    }

    const container = makeContainer(HiddenCommand, VisibleCommand);
    const registry = new ConsoleRegistry(container);
    registry.registerFromClasses([HiddenCommand, VisibleCommand]);

    const names = registry.list().map((e) => e.name);
    expect(names).not.toContain("hidden");
    expect(names).toContain("visible");
  });

  test("throws on duplicate command name", () => {
    @Injectable()
    class CmdA {
      @ConsoleCommand("dup")
      handle() {}
    }
    @Injectable()
    class CmdB {
      @ConsoleCommand("dup")
      handle() {}
    }

    const container = makeContainer(CmdA, CmdB);
    const registry = new ConsoleRegistry(container);
    expect(() => registry.registerFromClasses([CmdA, CmdB])).toThrow(/Duplicate console command/);
  });

  test("throws on duplicate alias", () => {
    @Injectable()
    class CmdA {
      @ConsoleCommand("alpha", { aliases: ["a"] })
      handle() {}
    }
    @Injectable()
    class CmdB {
      @ConsoleCommand("beta", { aliases: ["a"] })
      handle() {}
    }

    const container = makeContainer(CmdA, CmdB);
    const registry = new ConsoleRegistry(container);
    expect(() => registry.registerFromClasses([CmdA, CmdB])).toThrow(/Duplicate console alias/);
  });

  test("suggest returns near matches", () => {
    @Injectable()
    class GrettCommand {
      @ConsoleCommand("greet")
      handle() {}
    }

    const container = makeContainer(GrettCommand);
    const registry = new ConsoleRegistry(container);
    registry.registerFromClasses([GrettCommand]);

    const suggestions = registry.suggest("greett");
    expect(suggestions).toContain("greet");
  });

  test("derive class name when no explicit name given (single method)", () => {
    @Injectable()
    class UsersExportCommand {
      @ConsoleCommand()
      run() {}
    }

    const container = makeContainer(UsersExportCommand);
    const registry = new ConsoleRegistry(container);
    registry.registerFromClasses([UsersExportCommand]);

    expect(registry.find("users-export")).toBeDefined();
  });
});
