import "../reflect-setup";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { enumType } from "./enum";

const PROPERTY_METADATA_KEY = "schema:properties";

export type ClassConstructor<T = any> = new (...args: any[]) => T;

export interface ValidationError {
  property: string;
  value?: unknown;
  constraints?: Record<string, string>;
  children?: ValidationError[];
}

export interface PropertyMetadata {
  type?: "string" | "number" | "integer" | "boolean" | "array";
  options?: Record<string, unknown>;
  optional?: boolean;
  enumValues?: Record<string, string | number> | readonly (string | number)[];
  nested?: { each?: boolean };
  constraints: ValidationConstraint[];
}

type ValidationConstraint =
  | { type: "min"; value: number }
  | { type: "max"; value: number }
  | { type: "minLength"; value: number }
  | { type: "maxLength"; value: number }
  | { type: "pattern"; value: string }
  | { type: "format"; value: string }
  | { type: "minItems"; value: number }
  | { type: "maxItems"; value: number };

/** Module-level registry: DTO class → compiled TypeBox schema. */
const dtoRegistry = new Map<Function, TSchema>();

interface DtoMetaCacheEntry {
  properties: Record<string, PropertyMetadata>;
  knownKeys: Set<string>;
  hasValidation: boolean;
}

/** Cache of per-class metadata derived from `Reflect.getMetadata`. */
const dtoMetaCache = new WeakMap<Function, DtoMetaCacheEntry>();

function getDtoMetaCache(target: Function): DtoMetaCacheEntry {
  const cached = dtoMetaCache.get(target);
  if (cached) return cached;

  const properties: Record<string, PropertyMetadata> =
    Reflect.getMetadata(PROPERTY_METADATA_KEY, (target as ClassConstructor).prototype) ?? {};
  const keys = Object.keys(properties);
  const entry: DtoMetaCacheEntry = {
    properties,
    knownKeys: new Set(keys),
    hasValidation: keys.length > 0,
  };
  dtoMetaCache.set(target, entry);
  return entry;
}

function invalidateDtoCache(target: Function | undefined): void {
  if (!target) return;
  dtoRegistry.delete(target);
  dtoMetaCache.delete(target);
}

export function Dto(): ClassDecorator {
  return (target: Function) => {
    dtoRegistry.set(target, buildSchemaFromClass(target as ClassConstructor));
  };
}

export function getDtoSchema(target: Function): TSchema | undefined {
  return dtoRegistry.get(target);
}

export function getOrCreateDtoSchema(target: Function): TSchema | undefined {
  const existing = dtoRegistry.get(target);
  if (existing) return existing;
  if (!getDtoMetaCache(target).hasValidation) return undefined;
  const schema = buildSchemaFromClass(target as ClassConstructor);
  dtoRegistry.set(target, schema);
  return schema;
}

export function hasValidationMetadata(target: Function): boolean {
  return getDtoMetaCache(target).hasValidation;
}

export function getClassPropertyMetadata(
  klass: ClassConstructor,
): Record<string, PropertyMetadata> {
  return getDtoMetaCache(klass).properties;
}

export function setPropertyMetadata(
  target: any,
  key: string,
  updater: Partial<PropertyMetadata> | ((meta: PropertyMetadata) => void),
): void {
  const existing: Record<string, PropertyMetadata> =
    Reflect.getMetadata(PROPERTY_METADATA_KEY, target) ?? {};
  const current: PropertyMetadata = existing[key] ?? { constraints: [] };

  if (typeof updater === "function") {
    updater(current);
  } else {
    existing[key] = mergePropertyMetadata(current, updater);
  }

  if (!existing[key]) {
    existing[key] = current;
  }

  Reflect.defineMetadata(PROPERTY_METADATA_KEY, existing, target);
  invalidateDtoCache(target.constructor as Function | undefined);
}

export function buildSchemaFromClass(klass: ClassConstructor): TSchema {
  const properties = getClassPropertyMetadata(klass);
  const keys = Object.keys(properties);
  if (keys.length === 0) return Type.Object({});

  const objSchema: Record<string, TSchema> = {};
  for (const key of keys) {
    objSchema[key] = inferSchema(klass, key, properties[key]);
  }
  return Type.Object(objSchema);
}

export function validateDto(value: unknown, metatype: Function): ValidationError[] {
  const schema = getOrCreateDtoSchema(metatype);
  if (!schema) return [];

  // Fast path: most requests are valid. Avoid materializing the error iterator
  // when the value passes the schema check.
  if (Value.Check(schema, value)) return [];

  return normalizeValidationErrors([...Value.Errors(schema, value)]);
}

export async function validate(value: object): Promise<ValidationError[]> {
  return validateSync(value);
}

export function validateSync(value: object): ValidationError[] {
  return validateDto(value, value.constructor);
}

export async function validateOrReject(value: object): Promise<void> {
  const errors = validateSync(value);
  if (errors.length > 0) {
    throw errors;
  }
}

export function plainToInstance<T>(metatype: ClassConstructor<T>, value: unknown): T {
  if (value === null || value === undefined) {
    return value as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => plainToInstance(metatype, item)) as T;
  }

  if (typeof value !== "object") {
    return value as T;
  }

  const instance = new metatype();
  const metadata = getClassPropertyMetadata(metatype);

  for (const [key, property] of Object.entries(value as Record<string, unknown>)) {
    const propertyMeta = metadata[key];
    if (!propertyMeta?.nested) {
      (instance as Record<string, unknown>)[key] = property;
      continue;
    }

    const nestedType = Reflect.getMetadata("design:type", metatype.prototype, key) as
      | ClassConstructor
      | undefined;

    if (!nestedType || nestedType === Array) {
      (instance as Record<string, unknown>)[key] = property;
      continue;
    }

    if (propertyMeta.nested.each && Array.isArray(property)) {
      (instance as Record<string, unknown>)[key] = property.map((item) =>
        plainToInstance(nestedType, item),
      );
      continue;
    }

    (instance as Record<string, unknown>)[key] = plainToInstance(nestedType, property);
  }

  return instance;
}

export function stripUnknownProperties<T extends Record<string, unknown>>(
  value: T,
  metatype: Function,
): T {
  const knownKeys = getDtoMetaCache(metatype).knownKeys;
  return Object.fromEntries(Object.entries(value).filter(([key]) => knownKeys.has(key))) as T;
}

export function getUnknownPropertyKeys(value: unknown, metatype: Function): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const knownKeys = getDtoMetaCache(metatype).knownKeys;
  return Object.keys(value as Record<string, unknown>).filter((key) => !knownKeys.has(key));
}

function mergePropertyMetadata(
  current: PropertyMetadata,
  next: Partial<PropertyMetadata>,
): PropertyMetadata {
  return {
    ...current,
    ...next,
    options: { ...current.options, ...next.options },
    constraints: [...current.constraints, ...(next.constraints ?? [])],
  };
}

function inferSchema(klass: ClassConstructor, key: string, meta: PropertyMetadata): TSchema {
  const baseSchema = inferBaseSchema(klass, key, meta);
  return meta.optional ? Type.Optional(baseSchema) : baseSchema;
}

function inferBaseSchema(klass: ClassConstructor, key: string, meta: PropertyMetadata): TSchema {
  if (meta.enumValues) {
    return enumType(meta.enumValues);
  }

  if (meta.nested) {
    const nestedType = Reflect.getMetadata("design:type", klass.prototype, key) as
      | ClassConstructor
      | undefined;
    const nestedSchema =
      nestedType && nestedType !== Array
        ? (getOrCreateDtoSchema(nestedType) ?? Type.Any())
        : Type.Any();
    if (meta.nested.each || meta.type === "array" || nestedType === Array) {
      return Type.Array(nestedSchema, getArrayOptions(meta));
    }
    return nestedSchema;
  }

  const designType = Reflect.getMetadata("design:type", klass.prototype, key) as
    | Function
    | undefined;
  const resolvedType = meta.type ?? inferTypeFromMetadata(meta, designType);

  switch (resolvedType) {
    case "string":
      return Type.String(getStringOptions(meta));
    case "number":
      return Type.Number(getNumberOptions(meta));
    case "integer":
      return Type.Integer(getNumberOptions(meta));
    case "boolean":
      return Type.Boolean();
    case "array":
      return Type.Array(Type.Any(), getArrayOptions(meta));
    default:
      return Type.Any();
  }
}

function inferTypeFromMetadata(
  meta: PropertyMetadata,
  designType?: Function,
): PropertyMetadata["type"] | undefined {
  if (
    meta.constraints.some(
      (constraint) => constraint.type === "minItems" || constraint.type === "maxItems",
    )
  ) {
    return "array";
  }
  if (
    meta.constraints.some((constraint) =>
      ["minLength", "maxLength", "pattern", "format"].includes(constraint.type),
    )
  ) {
    return "string";
  }
  if (
    meta.constraints.some((constraint) => constraint.type === "min" || constraint.type === "max")
  ) {
    return "number";
  }
  if (designType === String) return "string";
  if (designType === Number) return "number";
  if (designType === Boolean) return "boolean";
  if (designType === Array) return "array";
  return undefined;
}

function getStringOptions(meta: PropertyMetadata): Record<string, unknown> {
  const options: Record<string, unknown> = { ...meta.options };
  for (const constraint of meta.constraints) {
    if (constraint.type === "minLength") options.minLength = constraint.value;
    if (constraint.type === "maxLength") options.maxLength = constraint.value;
    if (constraint.type === "pattern") options.pattern = constraint.value;
    if (constraint.type === "format") options.format = constraint.value;
  }
  return options;
}

function getNumberOptions(meta: PropertyMetadata): Record<string, unknown> {
  const options: Record<string, unknown> = { ...meta.options };
  for (const constraint of meta.constraints) {
    if (constraint.type === "min") options.minimum = constraint.value;
    if (constraint.type === "max") options.maximum = constraint.value;
  }
  return options;
}

function getArrayOptions(meta: PropertyMetadata): Record<string, unknown> {
  const options: Record<string, unknown> = { ...meta.options };
  for (const constraint of meta.constraints) {
    if (constraint.type === "minItems") options.minItems = constraint.value;
    if (constraint.type === "maxItems") options.maxItems = constraint.value;
  }
  return options;
}

function normalizeValidationErrors(errors: Array<Record<string, any>>): ValidationError[] {
  const grouped = new Map<string, ValidationError>();

  for (const error of errors) {
    const path = normalizeErrorPath(error.path);
    const [property, ...rest] = path.split(".").filter(Boolean);
    if (!property) continue;

    const existing = grouped.get(property) ?? {
      property,
      value: error.value,
      constraints: {},
      children: [],
    };
    grouped.set(property, existing);

    if (rest.length === 0) {
      (existing.constraints as Record<string, string>)[
        error.type ?? `rule_${existing.children!.length}`
      ] = error.message ?? "Validation failed";
      continue;
    }

    addChildError(existing, rest, error);
  }

  return [...grouped.values()].map((entry) => {
    if (entry.constraints && Object.keys(entry.constraints).length === 0) delete entry.constraints;
    if (entry.children && entry.children.length === 0) delete entry.children;
    return entry;
  });
}

function addChildError(parent: ValidationError, path: string[], error: Record<string, any>): void {
  const [segment, ...rest] = path;
  parent.children ??= [];
  let child = parent.children.find((entry) => entry.property === segment);
  if (!child) {
    child = { property: segment, value: error.value, constraints: {}, children: [] };
    parent.children.push(child);
  }

  if (rest.length === 0) {
    child.constraints ??= {};
    (child.constraints as Record<string, string>)[
      error.type ?? `rule_${child.children?.length ?? 0}`
    ] = error.message ?? "Validation failed";
    return;
  }

  addChildError(child, rest, error);
}

function normalizeErrorPath(path: string | undefined): string {
  if (!path) return "";
  return path
    .replace(/^\//, "")
    .replace(/\//g, ".")
    .replace(/\[(\d+)\]/g, ".$1");
}
