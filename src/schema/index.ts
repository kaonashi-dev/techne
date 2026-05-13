import "../reflect-setup";
import { t } from "elysia";
import { enumType } from "./enum";
import {
  setPropertyMetadata,
  buildSchemaFromClass,
  Dto,
  getDtoSchema,
  getOrCreateDtoSchema,
  plainToInstance,
  stripUnknownProperties,
  getUnknownPropertyKeys,
  validate,
  validateDto,
  validateOrReject,
  validateSync,
} from "./dto";

// ─── Property decorators (class-validator style) ─────────────────────────────

export const Type: any = t;

export function IsString(options?: Parameters<typeof t.String>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "string", options });
  };
}

export function IsNumber(options?: Parameters<typeof t.Number>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "number", options });
  };
}

export function IsInteger(options?: Parameters<typeof t.Integer>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "integer", options });
  };
}

export const IsInt = IsInteger;

export function IsBoolean() {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "boolean" });
  };
}

export function IsEnum(values: any) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { enumValues: values });
  };
}

export function IsOptional() {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { optional: true });
  };
}

export function IsArray(options?: { minItems?: number; maxItems?: number }) {
  return (target: any, key: string) => {
    const constraints = [];
    if (options?.minItems !== undefined)
      constraints.push({ type: "minItems" as const, value: options.minItems });
    if (options?.maxItems !== undefined)
      constraints.push({ type: "maxItems" as const, value: options.maxItems });
    setPropertyMetadata(target, key, { type: "array", constraints });
  };
}

export function Min(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "min", value }] });
  };
}

export function Max(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "max", value }] });
  };
}

export function MinLength(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "minLength", value }] });
  };
}

export function MaxLength(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "maxLength", value }] });
  };
}

export function Length(min: number, max?: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, {
      constraints: [
        { type: "minLength", value: min },
        ...(max === undefined ? [] : [{ type: "maxLength" as const, value: max }]),
      ],
    });
  };
}

export function Matches(pattern: RegExp | string) {
  return (target: any, key: string) => {
    const source = pattern instanceof RegExp ? pattern.source : pattern;
    setPropertyMetadata(target, key, { constraints: [{ type: "pattern", value: source }] });
  };
}

export function IsEmail() {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "format", value: "email" }] });
  };
}

export function IsUUID() {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "format", value: "uuid" }] });
  };
}

export function ArrayMinSize(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "minItems", value }] });
  };
}

export function ArrayMaxSize(value: number) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { constraints: [{ type: "maxItems", value }] });
  };
}

export function ValidateNested(options?: { each?: boolean }) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { nested: { each: options?.each } });
  };
}

// ─── Legacy aliases (backwards compatible) ───────────────────────────────────

/** @deprecated Use `IsString` instead */
export const String = IsString;
/** @deprecated Use `IsNumber` instead */
export const Number = IsNumber;
/** @deprecated Use `IsInteger` instead */
export const Integer = IsInteger;
/** @deprecated Use `IsBoolean` instead */
export const Boolean = IsBoolean;
/** @deprecated Use `IsEnum` instead */
export const Enum = IsEnum;

export function Optional(schema: any) {
  return t.Optional(schema);
}

// ─── Schema builder object ────────────────────────────────────────────────────

export const Schema: Record<string, any> = {
  Object: (...args: any[]) => {
    if (args.length === 0) return t.Object({});
    const [schemaOrClass] = args;

    if (typeof schemaOrClass === "function" && schemaOrClass.prototype !== undefined) {
      return buildSchemaFromClass(schemaOrClass);
    }

    return t.Object(schemaOrClass);
  },

  Array: t.Array,
  String: t.String,
  Number: t.Number,
  Boolean: t.Boolean,
  Integer: t.Integer,
  Literal: t.Literal,
  Union: t.Union,
  Intersect: t.Intersect,
  Optional: t.Optional,
  Readonly: t.Readonly,
  Record: t.Record,
  Tuple: t.Tuple,
  Any: t.Any,
  Unknown: t.Unknown,
  Never: t.Never,
  Partial: t.Partial,
  Required: t.Required,
  Pick: t.Pick,
  Omit: t.Omit,
  enum: enumType,
};

export {
  enumType,
  Dto,
  getDtoSchema,
  getOrCreateDtoSchema,
  plainToInstance,
  stripUnknownProperties,
  getUnknownPropertyKeys,
  validate,
  validateDto,
  validateOrReject,
  validateSync,
};
export { compileStringifier } from "./fast-stringify";
