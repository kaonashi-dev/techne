import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { ConsoleCommand } from "../src/console/decorators/console-command.decorator";
import { Argument, Option } from "../src/console/decorators/argument.decorator";
import { CONSOLE_COMMAND_METADATA, CONSOLE_PARAMS_METADATA } from "../src/common/constants";

describe("@ConsoleCommand", () => {
  test("writes method name and meta to class", () => {
    class Cmd {
      @ConsoleCommand("greet", { description: "Greet someone" })
      handle() {}
    }
    const map = Reflect.getMetadata(CONSOLE_COMMAND_METADATA, Cmd);
    expect(map).toEqual({ handle: { name: "greet", description: "Greet someone" } });
  });

  test("defaults name to method name when not supplied", () => {
    class Cmd {
      @ConsoleCommand()
      run() {}
    }
    const map = Reflect.getMetadata(CONSOLE_COMMAND_METADATA, Cmd);
    expect(map.run.name).toBe("run");
  });

  test("multiple methods on same class", () => {
    class Cmd {
      @ConsoleCommand("a")
      doA() {}

      @ConsoleCommand("b")
      doB() {}
    }
    const map = Reflect.getMetadata(CONSOLE_COMMAND_METADATA, Cmd);
    expect(Object.keys(map)).toHaveLength(2);
  });
});

describe("@Argument / @Option", () => {
  test("@Argument stores correct metadata", () => {
    class Cmd {
      @ConsoleCommand("greet")
      handle(@Argument("name", { description: "who to greet" }) _name: string) {}
    }
    const params = Reflect.getMetadata(CONSOLE_PARAMS_METADATA, Cmd);
    const [p] = params.handle;
    expect(p.kind).toBe("argument");
    expect(p.name).toBe("name");
    expect(p.index).toBe(0);
    expect(p.description).toBe("who to greet");
    expect(p.required).toBe(true);
    expect(p.metatype).toBe(String);
  });

  test("@Option stores kind option with aliases", () => {
    class Cmd {
      @ConsoleCommand("export")
      handle(@Option("limit", { aliases: ["l"], default: 10 }) _limit: number) {}
    }
    const params = Reflect.getMetadata(CONSOLE_PARAMS_METADATA, Cmd);
    const [p] = params.handle;
    expect(p.kind).toBe("option");
    expect(p.name).toBe("limit");
    expect(p.aliases).toEqual(["l"]);
    expect(p.default).toBe(10);
    expect(p.required).toBe(false);
    expect(p.metatype).toBe(Number);
  });

  test("@Argument with default sets required false", () => {
    class Cmd {
      @ConsoleCommand("foo")
      handle(@Argument("env", { default: "dev" }) _env: string) {}
    }
    const params = Reflect.getMetadata(CONSOLE_PARAMS_METADATA, Cmd);
    expect(params.handle[0].required).toBe(false);
  });
});
