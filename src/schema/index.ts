import "../reflect-setup";
import { Type } from "@sinclair/typebox";
import { enumType } from "./enum";
import { setPropertyMetadata, buildSchemaFromClass, Dto, getDtoSchema } from "./dto";

// ─── Property decorators (class-validator style) ─────────────────────────────

export function IsString(options?: Parameters<typeof Type.String>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "string", options });
  };
}

export function IsNumber(options?: Parameters<typeof Type.Number>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "number", options });
  };
}

export function IsInteger(options?: Parameters<typeof Type.Integer>[0]) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "integer", options });
  };
}

export function IsBoolean() {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { type: "boolean" });
  };
}

export function IsEnum(values: any) {
  return (target: any, key: string) => {
    setPropertyMetadata(target, key, { enum: values });
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
  return Type.Optional(schema);
}

// ─── Schema builder object ────────────────────────────────────────────────────

export const Schema = {
  Object: (...args: any[]) => {
    if (args.length === 0) return Type.Object({});
    const [schemaOrClass] = args;

    if (typeof schemaOrClass === "function" && schemaOrClass.prototype !== undefined) {
      return buildSchemaFromClass(schemaOrClass);
    }

    return Type.Object(schemaOrClass);
  },

  Array: Type.Array,
  String: Type.String,
  Number: Type.Number,
  Boolean: Type.Boolean,
  Integer: Type.Integer,
  Literal: Type.Literal,
  Union: Type.Union,
  Intersect: Type.Intersect,
  Optional: Type.Optional,
  Readonly: Type.Readonly,
  Record: Type.Record,
  Tuple: Type.Tuple,
  Any: Type.Any,
  Unknown: Type.Unknown,
  Never: Type.Never,
  Partial: Type.Partial,
  Required: Type.Required,
  Pick: Type.Pick,
  Omit: Type.Omit,
  enum: enumType,
};

export { Type, enumType, Dto, getDtoSchema };
