import "../../reflect-setup";
import { CONSOLE_PARAMS_METADATA } from "../../common/constants";
import type { ConsoleParamKind, ConsoleParamMeta } from "../types";

function getMetatype(target: object, propertyKey: string, index: number): Function | undefined {
  const types = Reflect.getMetadata("design:paramtypes", target, propertyKey) as
    | Function[]
    | undefined;
  return types?.[index];
}

function addConsoleParam(
  target: object,
  propertyKey: string,
  index: number,
  meta: Omit<ConsoleParamMeta, "index" | "metatype">,
) {
  const all: Record<string, ConsoleParamMeta[]> =
    Reflect.getMetadata(CONSOLE_PARAMS_METADATA, (target as any).constructor) ?? {};
  const list = all[propertyKey] ?? [];
  list.push({ index, metatype: getMetatype(target, propertyKey, index), ...meta });
  all[propertyKey] = list;
  Reflect.defineMetadata(CONSOLE_PARAMS_METADATA, all, (target as any).constructor);
}

export interface ArgumentOptions {
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: Record<string, string | number>;
}

export function Argument(name: string, opts: ArgumentOptions = {}): ParameterDecorator {
  return (target, propertyKey, index) => {
    if (!propertyKey) return;
    addConsoleParam(target, String(propertyKey), index, {
      kind: "argument" as ConsoleParamKind,
      name,
      required: opts.default === undefined ? (opts.required ?? true) : false,
      default: opts.default,
      description: opts.description,
      enum: opts.enum,
    });
  };
}

export interface OptionOptions extends ArgumentOptions {
  aliases?: string[];
}

export function Option(name: string, opts: OptionOptions = {}): ParameterDecorator {
  return (target, propertyKey, index) => {
    if (!propertyKey) return;
    addConsoleParam(target, String(propertyKey), index, {
      kind: "option" as ConsoleParamKind,
      name,
      aliases: opts.aliases,
      required: opts.required ?? false,
      default: opts.default,
      description: opts.description,
      enum: opts.enum,
    });
  };
}

/**
 * Collect all `--flag value` pairs from the CLI into a single typed and
 * validated bag. The `DtoClass` must be decorated with `@Dto()` (or at
 * minimum have `@Is*` property decorators from the schema package).
 *
 * At resolution time the argument resolver:
 * 1. Picks up all options from `ParsedArgv.options`.
 * 2. Coerces each value based on `design:type` metadata on the DTO class.
 * 3. Validates using the compiled DTO validator.
 * 4. Throws `ConsoleArgumentError` with the first validation error on failure.
 *
 * @example
 *   @ConsoleCommand("deploy")
 *   class DeployCommand {
 *     run(@Options(DeployOptionsDto) opts: DeployOptionsDto) {}
 *   }
 */
export function Options(dtoClass: new (...args: any[]) => any): ParameterDecorator {
  return (target, propertyKey, index) => {
    if (!propertyKey) return;
    addConsoleParam(target, String(propertyKey), index, {
      kind: "options-bag" as ConsoleParamKind,
      name: "__options_bag__",
      dtoClass,
    });
  };
}
