import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import { createConsoleTester } from "../src/console/testing";
import { ConsoleCommand } from "../src/console/decorators/console-command.decorator";
import { Argument } from "../src/console/decorators/argument.decorator";
import { Console } from "../src/console/console.service";
import { Injectable } from "../src/decorators/injectable.decorator";

@Injectable()
class GreetCommand {
  constructor(private readonly console: Console) {}

  @ConsoleCommand("greet", { description: "Greet someone" })
  handle(@Argument("name") name: string) {
    this.console.success(`Hello, ${name}!`);
  }
}

describe("createConsoleTester", () => {
  test("assertSuccess and assertSee", async () => {
    const tester = await createConsoleTester({ providers: [GreetCommand] });
    const result = await tester.call("greet", "World");
    result.assertSuccess().assertSee("Hello, World!");
    await tester.close();
  });

  test("assertExitCode", async () => {
    const tester = await createConsoleTester({ providers: [GreetCommand] });
    const result = await tester.call("greet", ["World"]);
    result.assertExitCode(0);
    await tester.close();
  });

  test("assertSee throws when text is absent", async () => {
    const tester = await createConsoleTester({ providers: [GreetCommand] });
    const result = await tester.call("greet", "World");
    expect(() => result.assertSee("Goodbye")).toThrow(/Expected output to contain/);
    await tester.close();
  });

  test("string args are split on whitespace", async () => {
    const tester = await createConsoleTester({ providers: [GreetCommand] });
    const result = await tester.call("greet", "Alice Bob");
    result.assertSee("Hello, Alice!");
    await tester.close();
  });
});
