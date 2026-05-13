import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";

/** Re-export of TypeBox `Type` for ergonomic schema authoring. */
export const t = Type;

export interface DefineConfigOptions<S extends TSchema> {
  schema: S;
  /** Source of values. Defaults to Bun.env. */
  source?: Record<string, string | undefined>;
  /** Coerce string env values into numbers/booleans/arrays before validation. Default true. */
  coerce?: boolean;
  /** Override how an array env var is split. Default ",". */
  arraySeparator?: string;
}

export interface AppConfig<S extends TSchema> {
  readonly values: Static<S>;
  get<K extends keyof Static<S>>(key: K): Static<S>[K];
  getOrThrow<K extends keyof Static<S>>(key: K): NonNullable<Static<S>[K]>;
}

interface ConfigValidationFailure {
  field: string;
  received: unknown;
  reason: string;
}

const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const BOOL_TRUE = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE = new Set(["false", "0", "no", "off", ""]);

export class ConfigValidationError extends Error {
  readonly failures: ReadonlyArray<ConfigValidationFailure>;

  constructor(failures: ConfigValidationFailure[]) {
    super(formatFailures(failures));
    this.name = "ConfigValidationError";
    this.failures = failures;
  }
}

function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function formatReceived(value: unknown): string {
  if (value === undefined) return `${DIM}<undefined>${RESET}`;
  if (value === null) return `${DIM}<null>${RESET}`;
  if (typeof value === "string") return truncate(JSON.stringify(value));
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

function formatFailures(failures: ConfigValidationFailure[]): string {
  const header = `${RED}${BOLD}Config validation failed${RESET} ${DIM}(${failures.length} error${failures.length === 1 ? "" : "s"})${RESET}`;
  const lines = failures.map((failure) => {
    return [
      `  ${RED}✗${RESET} ${BOLD}${failure.field}${RESET}`,
      `      ${DIM}received:${RESET} ${YELLOW}${formatReceived(failure.received)}${RESET}`,
      `      ${DIM}reason:${RESET}   ${CYAN}${failure.reason}${RESET}`,
    ].join("\n");
  });
  return [header, ...lines].join("\n");
}

interface FieldKind {
  base: "string" | "number" | "integer" | "boolean" | "array" | "other";
  optional: boolean;
  itemKind?: "string" | "number" | "integer" | "boolean" | "other";
}

function describeFieldKind(node: any): FieldKind {
  const optional = Boolean(node?.[Symbol.for("TypeBox.Optional")]) || node?.optional === true;
  const type = node?.type;

  if (type === "number") return { base: "number", optional };
  if (type === "integer") return { base: "integer", optional };
  if (type === "boolean") return { base: "boolean", optional };
  if (type === "string") return { base: "string", optional };
  if (type === "array") {
    const itemType = node?.items?.type;
    let itemKind: FieldKind["itemKind"];
    if (itemType === "number") itemKind = "number";
    else if (itemType === "integer") itemKind = "integer";
    else if (itemType === "boolean") itemKind = "boolean";
    else if (itemType === "string") itemKind = "string";
    else itemKind = "other";
    return { base: "array", optional, itemKind };
  }
  // anyOf (Union) and other shapes — leave as raw string for validator to decide.
  return { base: "other", optional };
}

function coerceNumber(raw: string): number | string {
  if (raw.trim() === "") return raw;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

function coerceBoolean(raw: string): boolean | string {
  const lower = raw.toLowerCase();
  if (BOOL_TRUE.has(lower)) return true;
  if (BOOL_FALSE.has(lower)) return false;
  return raw;
}

function coerceArrayItem(item: string, kind: FieldKind["itemKind"]): unknown {
  switch (kind) {
    case "number":
    case "integer":
      return coerceNumber(item);
    case "boolean":
      return coerceBoolean(item);
    default:
      return item;
  }
}

function coerceValue(raw: string | undefined, kind: FieldKind, arraySeparator: string): unknown {
  // Optional + missing/empty → undefined, let the validator skip it.
  if (raw === undefined) return undefined;
  if (kind.optional && raw === "") return undefined;

  switch (kind.base) {
    case "number":
    case "integer":
      return coerceNumber(raw);
    case "boolean":
      return coerceBoolean(raw);
    case "array": {
      if (raw === "") return [];
      const parts = raw.split(arraySeparator).map((s) => s.trim());
      return parts.map((item) => coerceArrayItem(item, kind.itemKind));
    }
    case "string":
    case "other":
    default:
      return raw;
  }
}

function readableReason(error: { message?: string; type?: number }): string {
  return error.message ?? "Invalid value";
}

function topLevelField(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  if (!trimmed) return undefined;
  const slash = trimmed.indexOf("/");
  return slash === -1 ? trimmed : trimmed.slice(0, slash);
}

export function defineConfig<S extends TSchema>(opts: DefineConfigOptions<S>): AppConfig<S> {
  const schema = opts.schema;
  const source = opts.source ?? (Bun.env as Record<string, string | undefined>);
  const coerce = opts.coerce !== false;
  const arraySeparator = opts.arraySeparator ?? ",";

  const properties = (schema as any).properties ?? {};
  const propertyKeys = Object.keys(properties);

  const assembled: Record<string, unknown> = {};
  const rawByField: Record<string, unknown> = {};

  for (const key of propertyKeys) {
    const kind = describeFieldKind(properties[key]);
    const raw = source[key];
    rawByField[key] = raw;

    if (!coerce) {
      if (raw === undefined) continue;
      assembled[key] = raw;
      continue;
    }

    const value = coerceValue(raw, kind, arraySeparator);
    if (value === undefined) continue;
    assembled[key] = value;
  }

  const validator = TypeCompiler.Compile(schema);
  if (!validator.Check(assembled)) {
    const failuresMap = new Map<string, ConfigValidationFailure>();
    for (const error of validator.Errors(assembled)) {
      const field = topLevelField(error.path) ?? "<root>";
      if (failuresMap.has(field)) continue; // first error per field is the most useful
      failuresMap.set(field, {
        field,
        received: rawByField[field],
        reason: readableReason(error),
      });
    }
    throw new ConfigValidationError([...failuresMap.values()]);
  }

  const frozen = Object.freeze(assembled) as Static<S>;

  return {
    values: frozen,
    get<K extends keyof Static<S>>(key: K): Static<S>[K] {
      return (frozen as any)[key];
    },
    getOrThrow<K extends keyof Static<S>>(key: K): NonNullable<Static<S>[K]> {
      const value = (frozen as any)[key];
      if (value === null || value === undefined) {
        throw new Error(`Missing configuration value for "${String(key)}"`);
      }
      return value as NonNullable<Static<S>[K]>;
    },
  };
}
