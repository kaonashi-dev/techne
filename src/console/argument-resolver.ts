import { ConsoleArgumentError } from "./errors";
import type { ParsedArgv } from "./argv-parser";
import type { ConsoleParamMeta } from "./types";
import { firstValidationError, getClassPropertyMetadata } from "../schema/dto";

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

/**
 * Coerce a raw options object collected from CLI flags into a typed bag
 * matching `dtoClass`. Uses `design:type` metadata on the DTO class to
 * convert string flag values to the correct primitive type.
 */
function coerceOptionsBag(
  raw: Record<string, string | boolean | string[]>,
  dtoClass: new (...args: any[]) => any,
): Record<string, unknown> {
  const bag: Record<string, unknown> = {};
  const propMeta = getClassPropertyMetadata(dtoClass);

  for (const [key, value] of Object.entries(raw)) {
    // Determine the design:type of the property on the DTO class.
    const designType = Reflect.getMetadata(
      "design:type",
      (dtoClass as any).prototype,
      key,
    ) as Function | undefined;

    if (designType === Number) {
      const n = Number(value);
      bag[key] = Number.isNaN(n) ? value : n;
    } else if (designType === Boolean) {
      bag[key] = value === true || value === "true" || value === "1";
    } else {
      // Look at schema property metadata for type hints when design:type is absent.
      const meta = propMeta[key];
      if (meta?.type === "number" || meta?.type === "integer") {
        const n = Number(value);
        bag[key] = Number.isNaN(n) ? value : n;
      } else if (meta?.type === "boolean") {
        bag[key] = value === true || value === "true" || value === "1";
      } else {
        bag[key] = value;
      }
    }
  }

  return bag;
}

export function resolveArguments(params: ConsoleParamMeta[], parsed: ParsedArgv): unknown[] {
  const ordered = [...params].sort((a, b) => a.index - b.index);
  const args: unknown[] = Array.from({ length: ordered.length });
  let posCursor = 0;

  for (const p of ordered) {
    if (p.kind === "options-bag") {
      // Collect all --flags into a typed+validated bag.
      const dtoClass = p.dtoClass;
      if (!dtoClass) {
        args[p.index] = { ...parsed.options };
        continue;
      }
      const bag = coerceOptionsBag(parsed.options as Record<string, string | boolean | string[]>, dtoClass);
      const error = firstValidationError(bag, dtoClass);
      if (error) {
        const firstConstraint = error.constraints
          ? Object.values(error.constraints)[0]
          : undefined;
        const msg =
          firstConstraint ?? `Validation failed for option '${error.property}'`;
        throw new ConsoleArgumentError(msg);
      }
      args[p.index] = bag;
    } else if (p.kind === "argument") {
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
