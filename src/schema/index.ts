import "reflect-metadata";
import { Type } from "@sinclair/typebox";
import { enumType } from "./enum";

const PROPERTY_METADATA_KEY = "schema:properties";

export function String(options?: Parameters<typeof Type.String>[0]) {
  return (target: any, key: string) => {
    _setPropertyMetadata(target, key, { type: "string", options });
  };
}

export function Number(options?: Parameters<typeof Type.Number>[0]) {
  return (target: any, key: string) => {
    _setPropertyMetadata(target, key, { type: "number", options });
  };
}

export function Integer(options?: Parameters<typeof Type.Integer>[0]) {
  return (target: any, key: string) => {
    _setPropertyMetadata(target, key, { type: "integer", options });
  };
}

export function Boolean() {
  return (target: any, key: string) => {
    _setPropertyMetadata(target, key, { type: "boolean" });
  };
}

export function Enum(values: any) {
  return (target: any, key: string) => {
    _setPropertyMetadata(target, key, { enum: values });
  };
}

export function Optional(schema: any) {
  return Type.Optional(schema);
}

export const Schema = {
  Object: (...args: any[]) => {
    if (args.length === 0) return Type.Object({});
    const [schemaOrClass] = args;

    if (typeof schemaOrClass === "function" && schemaOrClass.prototype !== undefined) {
      return _classToObject(schemaOrClass);
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

function _setPropertyMetadata(target: any, key: string, meta: any) {
  const existing: Record<string, any> = Reflect.getMetadata(PROPERTY_METADATA_KEY, target) || {};
  existing[key] = meta;
  Reflect.defineMetadata(PROPERTY_METADATA_KEY, existing, target);
}

function _classToObject(klass: new (...args: any[]) => any) {
  const properties: Record<string, any> =
    Reflect.getMetadata(PROPERTY_METADATA_KEY, klass.prototype) || {};

  const keys = Object.keys(properties);
  if (keys.length === 0) return Type.Object({});

  const objSchema: Record<string, any> = {};

  for (const key of keys) {
    const meta = properties[key];
    objSchema[key] = _inferSchema(meta);
  }

  return Type.Object(objSchema);
}

function _inferSchema(meta: any): any {
  if (!meta) return Type.Any();

  if (meta.type) {
    switch (meta.type) {
      case "string":
        return Type.String(meta.options || {});
      case "number":
        return Type.Number(meta.options || {});
      case "integer":
        return Type.Integer(meta.options || {});
      case "boolean":
        return Type.Boolean();
      default:
        return Type.Any();
    }
  }

  if (meta.enum) return enumType(meta.enum);
  if (meta.schema) return meta.schema;

  return Type.Any();
}

export { Type, enumType };
