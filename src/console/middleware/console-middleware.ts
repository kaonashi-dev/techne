import type { CommandEntry } from "../types";
import type { ParsedArgv } from "../argv-parser";

export interface ConsoleInvocation {
  name: string;
  argv: string[];
  parsed: ParsedArgv;
  command?: CommandEntry;
}

export type ConsoleNext = (inv: ConsoleInvocation) => Promise<number>;

export interface ConsoleMiddleware {
  handle(inv: ConsoleInvocation, next: ConsoleNext): Promise<number>;
}

export function buildConsoleStack(mws: ConsoleMiddleware[], core: ConsoleNext): ConsoleNext {
  return mws.reduceRight<ConsoleNext>((next, mw) => (inv) => mw.handle(inv, next), core);
}
