import { CONSOLE_COMMAND_METADATA, CONSOLE_PARAMS_METADATA } from "../common/constants";
import { type Container, isCustomProvider } from "../core/container";
import type { CommandEntry, ConsoleCommandMeta, ConsoleParamMeta } from "./types";
import { deriveCommandName } from "./naming";

export class ConsoleRegistry {
  private readonly byName = new Map<string, CommandEntry>();
  private readonly aliases = new Map<string, string>();

  constructor(private readonly container: Container) {}

  registerFromClasses(classes: any[]): void {
    for (const provider of classes) {
      if (isCustomProvider(provider)) continue;
      const map = Reflect.getMetadata(CONSOLE_COMMAND_METADATA, provider) as
        | Record<string, ConsoleCommandMeta>
        | undefined;
      if (!map) continue;
      if (!this.container.isStatic(provider)) continue;

      const params = (Reflect.getMetadata(CONSOLE_PARAMS_METADATA, provider) ?? {}) as Record<
        string,
        ConsoleParamMeta[]
      >;
      const methodCount = Object.keys(map).length;

      for (const [methodName, meta] of Object.entries(map)) {
        const name = deriveCommandName(provider, methodName, meta, methodCount);
        if (this.byName.has(name)) {
          throw new Error(
            `Duplicate console command name "${name}" (${provider.name}.${methodName})`,
          );
        }
        const entry: CommandEntry = {
          name,
          ctor: provider,
          methodName,
          meta: { ...meta, name },
          params: [...(params[methodName] ?? [])].sort((a, b) => a.index - b.index),
        };
        this.byName.set(name, entry);
        for (const a of meta.aliases ?? []) {
          if (this.aliases.has(a) || this.byName.has(a)) {
            throw new Error(`Duplicate console alias "${a}"`);
          }
          this.aliases.set(a, name);
        }
      }
    }
  }

  find(name: string): CommandEntry | undefined {
    return this.byName.get(name) ?? this.byName.get(this.aliases.get(name) ?? "");
  }

  list(): CommandEntry[] {
    return [...this.byName.values()]
      .filter((e) => !e.meta.hidden)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  all(): CommandEntry[] {
    return [...this.byName.values()];
  }

  suggest(name: string, max = 3): string[] {
    const keys = [...this.byName.keys()];
    const scored = keys
      .map((k) => ({ name: k, dist: levenshtein(name, k) }))
      .filter((x) => x.dist <= 3)
      .sort((a, b) => a.dist - b.dist);
    return scored.slice(0, max).map((x) => x.name);
  }
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
