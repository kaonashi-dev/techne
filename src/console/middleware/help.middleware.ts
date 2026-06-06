import type { Console } from "../console.service";
import { ExitCode } from "../exit-code";
import type { ConsoleInvocation, ConsoleMiddleware, ConsoleNext } from "./console-middleware";

export class HelpMiddleware implements ConsoleMiddleware {
  constructor(private readonly console: Console) {}

  async handle(inv: ConsoleInvocation, next: ConsoleNext): Promise<number> {
    if (!inv.parsed.options.help && !inv.parsed.options.h) {
      return next(inv);
    }

    const cmd = inv.command;
    if (!cmd) return next(inv);

    const lines: string[] = [];
    lines.push(`Usage: techne run ${cmd.name}`);

    const args = cmd.params.filter((p) => p.kind === "argument");
    const opts = cmd.params.filter((p) => p.kind === "option");

    if (args.length > 0) {
      const argStr = args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" ");
      lines[0] += ` ${argStr}`;
    }

    if (opts.length > 0) {
      lines[0] += " [options]";
    }

    if (cmd.meta.description) {
      lines.push("");
      lines.push(cmd.meta.description);
    }

    if (args.length > 0) {
      lines.push("");
      lines.push("Arguments:");
      for (const a of args) {
        const req = a.required
          ? " (required)"
          : a.default !== undefined
            ? ` (default: ${a.default})`
            : "";
        lines.push(`  ${a.name.padEnd(20)} ${a.description ?? ""}${req}`);
      }
    }

    if (opts.length > 0) {
      lines.push("");
      lines.push("Options:");
      for (const o of opts) {
        const flags = [`--${o.name}`, ...(o.aliases ?? []).map((a) => `-${a}`)].join(", ");
        const def = o.default !== undefined ? ` (default: ${o.default})` : "";
        lines.push(`  ${flags.padEnd(20)} ${o.description ?? ""}${def}`);
      }
    }

    lines.push("  --help, -h           Show this help message");

    for (const line of lines) {
      this.console.writeln(line);
    }

    return ExitCode.SUCCESS;
  }
}
