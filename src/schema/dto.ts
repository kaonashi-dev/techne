import "../reflect-setup";
import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import { enumType } from "./enum";

const PROPERTY_METADATA_KEY = "schema:properties";

/** Module-level registry: DTO class → compiled TypeBox schema. */
const _dtoRegistry = new Map<Function, TSchema>();

/**
 * Class decorator.  Compiles all `@Is*` property decorators on the class into
 * a TypeBox `Object` schema and registers it so `@Body(MyDto)` can inject it
 * automatically into Elysia's validation pipeline.
 *
 * @example
 * ```ts
 * @Dto()
 * class CreateUserDto {
 *   @IsString({ minLength: 2 })
 *   name: string;
 *
 *   @IsNumber({ minimum: 0 })
 *   age: number;
 * }
 * ```
 */
export function Dto(): ClassDecorator {
  return (target: Function) => {
    const schema = _buildSchema(target as new (...args: any[]) => any);
    _dtoRegistry.set(target, schema);
  };
}

/** Returns the TypeBox schema registered for `target`, or `undefined`. */
export function getDtoSchema(target: Function): TSchema | undefined {
  return _dtoRegistry.get(target);
}

// ─── internal helpers (shared with schema/index.ts) ─────────────────────────

export function setPropertyMetadata(target: any, key: string, meta: any): void {
  const existing: Record<string, any> = Reflect.getMetadata(PROPERTY_METADATA_KEY, target) ?? {};
  existing[key] = meta;
  Reflect.defineMetadata(PROPERTY_METADATA_KEY, existing, target);
}

export function buildSchemaFromClass(klass: new (...args: any[]) => any): TSchema {
  return _buildSchema(klass);
}

function _buildSchema(klass: new (...args: any[]) => any): TSchema {
  const properties: Record<string, any> =
    Reflect.getMetadata(PROPERTY_METADATA_KEY, klass.prototype) ?? {};

  const keys = Object.keys(properties);
  if (keys.length === 0) return Type.Object({});

  const objSchema: Record<string, any> = {};
  for (const key of keys) {
    objSchema[key] = _inferSchema(properties[key]);
  }
  return Type.Object(objSchema);
}

function _inferSchema(meta: any): TSchema {
  if (!meta) return Type.Any();

  if (meta.type) {
    switch (meta.type) {
      case "string":
        return Type.String(meta.options ?? {});
      case "number":
        return Type.Number(meta.options ?? {});
      case "integer":
        return Type.Integer(meta.options ?? {});
      case "boolean":
        return Type.Boolean();
      default:
        return Type.Any();
    }
  }

  if (meta.enum) return enumType(meta.enum);
  if (meta.schema) return meta.schema as TSchema;

  return Type.Any();
}
