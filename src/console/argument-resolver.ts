import { ConsoleArgumentError } from "./errors";
import type { ParsedArgv } from "./argv-parser";
import type { ConsoleParamMeta } from "./types";

function coerce(value: unknown, p: ConsoleParamMeta): unknown {
  if (p.enum) {
    const vals = Object.values(p.enum);
    const s = String(value);
    const hit =
      vals.find((v) => String(v) === s) ?? (s in p.enum! ? (p.enum as any)[s] : undefined);
    if (hit === undefined) {
      throw new ConsoleArgumentError(
        `Invalid value "${s}" for <${p.name}>. Expected one of: ${vals.join(", ")}`,
      );
    }
    return hit;
  }
  if (p.metatype === Number) {
    const n = Number(value);
    if (Number.isNaN(n)) {
      throw new ConsoleArgumentError(`<${p.name}> must be a number, got "${value}"`);
    }
    return n;
  }
  if (p.metatype === Boolean) {
    return value === true || value === "true" || value === "1";
  }
  return value;
}

export function resolveArguments(params: ConsoleParamMeta[], parsed: ParsedArgv): unknown[] {
  const ordered = [...params].sort((a, b) => a.index - b.index);
  const args: unknown[] = Array.from({ length: ordered.length });
  let posCursor = 0;

  for (const p of ordered) {
    if (p.kind === "argument") {
      const raw = parsed.positionals[posCursor++];
      if (raw === undefined) {
        if (p.default !== undefined) {
          args[p.index] = p.default;
          continue;
        }
        if (p.required) throw new ConsoleArgumentError(`Missing required argument <${p.name}>`);
        args[p.index] = undefined;
        continue;
      }
      args[p.index] = coerce(raw, p);
    } else {
      let raw: unknown = parsed.options[p.name];
      if (raw === undefined) {
        for (const a of p.aliases ?? []) {
          if (a in parsed.options) {
            raw = parsed.options[a];
            break;
          }
        }
      }
      if (raw === undefined) {
        if (p.metatype === Boolean) {
          args[p.index] = p.default ?? false;
          continue;
        }
        if (p.default !== undefined) {
          args[p.index] = p.default;
          continue;
        }
        if (p.required) throw new ConsoleArgumentError(`Missing required option --${p.name}`);
        args[p.index] = undefined;
        continue;
      }
      args[p.index] = coerce(raw, p);
    }
  }

  return args;
}
