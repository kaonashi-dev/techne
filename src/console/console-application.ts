import type { Container } from "../core/container";
import type { Scanner } from "../core/scanner";
import type { Console } from "./console.service";
import { ConsoleRegistry } from "./console-registry";
import { parseArgv } from "./argv-parser";
import { resolveArguments } from "./argument-resolver";
import { ExitCode, normalizeExitCode } from "./exit-code";
import { ConsoleArgumentError } from "./errors";
import { buildConsoleStack, type ConsoleInvocation } from "./middleware/console-middleware";
import { HelpMiddleware } from "./middleware/help.middleware";
import { ResolveOrRescueMiddleware } from "./middleware/resolve-or-rescue.middleware";

export class ConsoleApplication {
  constructor(
    private readonly scanner: Scanner,
    private readonly container: Container,
    private readonly registry: ConsoleRegistry,
    private readonly console: Console,
  ) {}

  async run(name: string, argv: string[]): Promise<number> {
    const parsed = parseArgv(argv);
    const command = this.registry.find(name);
    const inv: ConsoleInvocation = { name, argv, parsed, command };

    const core = async (i: ConsoleInvocation): Promise<number> => {
      if (!i.command) return ExitCode.INVALID;
      const instance = this.container.get<any>(i.command.ctor);
      let args: unknown[];
      try {
        args = resolveArguments(i.command.params, i.parsed);
      } catch (e) {
        if (e instanceof ConsoleArgumentError) {
          this.console.error(e.message);
          return ExitCode.INVALID;
        }
        throw e;
      }
      try {
        return normalizeExitCode(await instance[i.command.methodName](...args));
      } catch (e) {
        this.console.error(e instanceof Error ? e.message : String(e));
        return ExitCode.ERROR;
      }
    };

    const globals = [
      new HelpMiddleware(this.console),
      new ResolveOrRescueMiddleware(this.console, this.registry),
    ];
    const perCommand = (command?.meta.middleware ?? []).map((m) => this.container.get<any>(m));
    return buildConsoleStack([...globals, ...perCommand], core)(inv);
  }

  list(): void {
    this.console.writeln("Available commands:\n");
    for (const e of this.registry.list()) {
      this.console.writeln(`  ${e.name.padEnd(24)} ${e.meta.description ?? ""}`);
    }
  }

  async close(): Promise<void> {
    await this.scanner.callLifecycleHook("onModuleDestroy");
  }
}
