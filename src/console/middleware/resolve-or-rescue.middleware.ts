import type { Console } from "../console.service";
import { ExitCode } from "../exit-code";
import type { ConsoleRegistry } from "../console-registry";
import type { ConsoleInvocation, ConsoleMiddleware, ConsoleNext } from "./console-middleware";

export class ResolveOrRescueMiddleware implements ConsoleMiddleware {
  constructor(
    private readonly console: Console,
    private readonly registry: ConsoleRegistry,
  ) {}

  async handle(inv: ConsoleInvocation, next: ConsoleNext): Promise<number> {
    if (inv.command) return next(inv);

    this.console.error(`Unknown command: "${inv.name}"`);

    const suggestions = this.registry.suggest(inv.name);
    if (suggestions.length > 0) {
      this.console.writeln("");
      this.console.writeln(`Did you mean one of these?`);
      for (const s of suggestions) {
        this.console.writeln(`  techne run ${s}`);
      }
    }

    return ExitCode.INVALID;
  }
}
