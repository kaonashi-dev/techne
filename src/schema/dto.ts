import "../reflect-setup";
import * as Type from "typebox/type";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import type { TypeCheck } from "./validator-types";
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

/** Module-level registry: DTO class → TypeBox schema and compiled validator. */
const dtoRegistry = new Map<Function, TSchema>();
const dtoValidatorRegistry = new Map<Function, TypeCheck<TSchema>>();
const dtoOptionsRegistry = new WeakMap<Function, DtoOptions>();

/**
 * Registry for header-safe DTO schemas (additionalProperties: true, lowercased keys).
 * Separate from dtoRegistry so the strict body validator is never mutated.
 */
const headerSchemaRegistry = new Map<Function, TSchema>();

/**
 * Registry for lenient DTO schemas (additionalProperties removed/true) used by
 * the strip-unknown feature. The strict body schema is never mutated.
 */
const lenientSchemaRegistry = new Map<Function, TSchema>();

export interface DtoOptions {
  allowAdditional?: boolean;
  /** When true, unknown top-level properties are stripped instead of rejected. */
  stripUnknown?: boolean;
}

interface DtoMetaCacheEntry {
  properties: Record<string, PropertyMetadata>;
  knownKeys: Set<string>;
  keys: string[];
  nestedTypes: Map<string, ClassConstructor | undefined>;
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
  const nestedTypes = new Map<string, ClassConstructor | undefined>();
  for (const key of keys) {
    if (properties[key].nested) {
      nestedTypes.set(
        key,
        Reflect.getMetadata("design:type", (target as ClassConstructor).prototype, key) as
          | ClassConstructor
          | undefined,
      );
    }
  }

  const entry: DtoMetaCacheEntry = {
    properties,
    knownKeys: new Set(keys),
    keys,
    nestedTypes,
    hasValidation: keys.length > 0,
  };
  dtoMetaCache.set(target, entry);
  return entry;
}

function invalidateDtoCache(target: Function | undefined): void {
  if (!target) return;
  dtoRegistry.delete(target);
  dtoValidatorRegistry.delete(target);
  dtoMetaCache.delete(target);
}

export function Dto(options: DtoOptions = {}): ClassDecorator {
  return (target: Function) => {
    dtoOptionsRegistry.set(target, options);
    const schema = buildSchemaFromClass(target as ClassConstructor);
    dtoRegistry.set(target, schema);
    dtoValidatorRegistry.set(target, Compile(schema));
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

/**
 * Builds a header-safe TypeBox schema from a DTO class.
 *
 * Differences from the body schema:
 * - `additionalProperties` is forced to `true` — HTTP headers always carry
 *   standard fields like `host`, `accept`, `user-agent`, etc. that are not
 *   part of the DTO, so rejecting unknown properties would break every request.
 * - All property keys are lowercased because Elysia (and the HTTP/1.1 spec)
 *   normalises header names to lowercase before placing them on `ctx.headers`.
 *
 * The result is cached in a separate registry so the strict body validator
 * is never mutated.
 */
export function buildHeaderSchemaFromClass(target: Function): TSchema {
  const cached = headerSchemaRegistry.get(target);
  if (cached) return cached;

  const strict = getOrCreateDtoSchema(target);
  if (!strict) {
    // DTO has no validation metadata — return an open object so all headers pass.
    const open = Type.Object({}, { additionalProperties: true });
    headerSchemaRegistry.set(target, open);
    return open;
  }

  // Clone the properties object, lowercasing all keys.
  const properties = (strict as any).properties as Record<string, TSchema> | undefined;
  const lowercasedProps: Record<string, TSchema> = {};
  if (properties) {
    for (const [key, schema] of Object.entries(properties)) {
      lowercasedProps[key.toLowerCase()] = schema;
    }
  }

  // Force additionalProperties: true — never use Type.Never() here.
  const headerSchema = Type.Object(lowercasedProps, { additionalProperties: true });
  headerSchemaRegistry.set(target, headerSchema);
  return headerSchema;
}

/**
 * Returns a lenient TypeBox schema derived from the DTO class with
 * `additionalProperties: true` (open object). Used by the strip-unknown
 * feature: Elysia validates the known properties but does not reject requests
 * that carry extra fields. The actual stripping happens in a per-route
 * `beforeHandle` step (see `router-execution-context.ts`).
 *
 * The schema is rebuilt from the class metadata using `Type.Object` with the
 * same property sub-schemas as the strict schema, but with
 * `additionalProperties: true`. This avoids mutating or symbol-stripping the
 * cached strict schema.
 *
 * **Note:** strip-unknown is top-level properties only in v1.
 *
 * The result is cached in a separate registry so the strict body validator is
 * never mutated.
 */
export function getOrCreateLenientDtoSchema(target: Function): TSchema | undefined {
  const cached = lenientSchemaRegistry.get(target);
  if (cached) return cached;

  const strict = getOrCreateDtoSchema(target);
  if (!strict) return undefined;

  // Extract the property sub-schemas from the strict TypeBox Object schema.
  // TypeBox stores them under the plain `properties` key.
  const properties = (strict as any).properties as Record<string, TSchema> | undefined;

  // Rebuild via Type.Object so the result is a proper TypeBox schema with the
  // [Kind] symbol and all TypeBox identity markers intact.
  const lenient = Type.Object(properties ?? {}, { additionalProperties: true });

  // Carry over the `required` array from the strict schema so required
  // properties are still validated.
  const required = (strict as any).required as string[] | undefined;
  if (required && required.length > 0) {
    (lenient as any).required = required;
  }

  lenientSchemaRegistry.set(target, lenient);
  return lenient;
}

/**
 * Returns true when unknown-property stripping is enabled for the DTO class.
 *
 * Resolution: an explicit per-DTO `@Dto({ stripUnknown })` value wins in both
 * directions; otherwise the `globalDefault` (the factory-level
 * `validation.stripUnknown` flag) applies.
 */
export function isDtoStripUnknown(target: Function, globalDefault = false): boolean {
  return dtoOptionsRegistry.get(target)?.stripUnknown ?? globalDefault;
}

function getOrCreateDtoValidator(target: Function): TypeCheck<TSchema> | undefined {
  const existing = dtoValidatorRegistry.get(target);
  if (existing) return existing;

  const schema = getOrCreateDtoSchema(target);
  if (!schema) return undefined;

  const validator = Compile(schema);
  dtoValidatorRegistry.set(target, validator);
  return validator;
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
  const meta = getDtoMetaCache(klass);
  const keys = meta.keys;
  const options = getObjectOptions(klass);
  if (keys.length === 0) return Type.Object({}, options);

  const objSchema: Record<string, TSchema> = {};
  for (const key of keys) {
    objSchema[key] = inferSchema(klass, key, meta.properties[key]);
  }
  return Type.Object(objSchema, options);
}

export function validateDto(value: unknown, metatype: Function): ValidationError[] {
  const validator = getOrCreateDtoValidator(metatype);
  if (!validator) return [];

  // Fast path: most requests are valid. Avoid materializing the error iterator
  // when the value passes the schema check.
  if (validator.Check(value)) return [];

  return normalizeValidationErrors([...validator.Errors(value)], value);
}

/**
 * Fast yes/no validity check. Skips the per-key error normalization in
 * `validateDto` — useful for the validation-pipe happy path where we only
 * care whether the value is valid.
 *
 * Returns `true` when the DTO has no validation metadata (parity with
 * `validateDto`, which returns `[]`).
 */
export function isValidDto(value: unknown, metatype: Function): boolean {
  const validator = getOrCreateDtoValidator(metatype);
  if (!validator) return true;
  return validator.Check(value);
}

/**
 * Materialize just the first validation error. The TypeBox `Errors` iterator
 * stops as soon as we pull one entry, so this avoids walking the entire
 * schema when we only need to surface the first failure (the rest can be
 * computed on-demand via {@link computeAllValidationErrors}).
 */
export function firstValidationError(
  value: unknown,
  metatype: Function,
): ValidationError | undefined {
  const validator = getOrCreateDtoValidator(metatype);
  if (!validator) return undefined;
  const iterator = validator.Errors(value)[Symbol.iterator]();
  const next = iterator.next();
  if (next.done || !next.value) return undefined;
  const errors = normalizeValidationErrors([next.value as Record<string, any>], value);
  return errors[0];
}

/**
 * Full, eager error enumeration for class-validator compatibility helpers.
 */
export function computeAllValidationErrors(value: unknown, metatype: Function): ValidationError[] {
  const validator = getOrCreateDtoValidator(metatype);
  if (!validator) return [];
  return normalizeValidationErrors([...validator.Errors(value)], value);
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
  const metadata = getDtoMetaCache(metatype);
  if (metadata.nestedTypes.size === 0) {
    return Object.assign(instance as object, value as object) as T;
  }

  const properties = metadata.properties;
  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    const property = record[key];
    const propertyMeta = properties[key];
    if (!propertyMeta?.nested) {
      (instance as Record<string, unknown>)[key] = property;
      continue;
    }

    const nestedType = metadata.nestedTypes.get(key);

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
  return stripUnknownPropertiesWithReport(value, metatype).value;
}

export interface StripUnknownPropertiesResult<T extends Record<string, unknown>> {
  value: T;
  unknownKeys: string[];
}

export function stripUnknownPropertiesWithReport<T extends Record<string, unknown>>(
  value: T,
  metatype: Function,
): StripUnknownPropertiesResult<T> {
  const knownKeys = getDtoMetaCache(metatype).knownKeys;
  const keys = Object.keys(value);
  const unknownKeys: string[] = [];
  let stripped: Record<string, unknown> | undefined;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (knownKeys.has(key)) {
      if (stripped) stripped[key] = value[key];
      continue;
    }

    unknownKeys.push(key);
    if (!stripped) {
      stripped = {};
      for (let j = 0; j < i; j++) {
        const previousKey = keys[j];
        if (knownKeys.has(previousKey)) stripped[previousKey] = value[previousKey];
      }
    }
  }

  return { value: (stripped ?? value) as T, unknownKeys };
}

export function getUnknownPropertyKeys(value: unknown, metatype: Function): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const knownKeys = getDtoMetaCache(metatype).knownKeys;
  const unknownKeys: string[] = [];
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (!knownKeys.has(key)) unknownKeys.push(key);
  }
  return unknownKeys;
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
    const nestedType = getDtoMetaCache(klass).nestedTypes.get(key);
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

function getObjectOptions(klass: ClassConstructor): Record<string, unknown> {
  const options = dtoOptionsRegistry.get(klass);
  return { additionalProperties: options?.allowAdditional === true ? true : Type.Never() };
}

/**
 * Collapse a raw validator error list into Techne's property-keyed
 * `ValidationError[]`.
 *
 * TypeBox 1.x (via Elysia 2) reports errors in the AJV/JSON-Schema idiom:
 * `instancePath` for the JSON Pointer, `keyword` for the failing constraint,
 * and no `value` field at all. TypeBox 0.34 used `path`, a numeric `type`, and
 * carried `value`. Both spellings are accepted so a caller passing 0.34-shaped
 * errors still normalizes correctly.
 *
 * `root` is the value that was validated. It exists solely to repopulate
 * `ValidationError.value`, which is part of Techne's public error shape but no
 * longer travels with the error itself.
 */
function normalizeValidationErrors(
  errors: Array<Record<string, any>>,
  root?: unknown,
): ValidationError[] {
  const grouped = new Map<string, ValidationError>();

  for (const error of errors) {
    const pointer = error.instancePath ?? error.path;
    const path = normalizeErrorPath(pointer);

    // TypeBox 1.x reports every missing required property as a SINGLE error
    // anchored at the containing object (`instancePath: ""`, `keyword:
    // "required"`, `params.requiredProperties: [...]`). TypeBox 0.34 instead
    // reported one error per property, anchored at that property's own path.
    // Fan the v1 form back out so each missing property gets its own entry —
    // without this the error lands on an empty path and is dropped entirely,
    // silently turning "missing required field" into "valid".
    const missing = error.params?.requiredProperties ?? error.params?.missingProperty;
    if (error.keyword === "required" && missing !== undefined) {
      for (const name of Array.isArray(missing) ? missing : [missing]) {
        const parentPath = path ? `${path}.${name}` : String(name);
        const segments = parentPath.split(".").filter(Boolean);
        recordConstraint(
          grouped,
          segments,
          root,
          "required",
          `must have required property ${name}`,
        );
      }
      continue;
    }

    const [property, ...rest] = path.split(".").filter(Boolean);
    if (!property) continue;

    const existing = grouped.get(property) ?? {
      property,
      value: "value" in error ? error.value : resolvePointer(root, [property]),
      constraints: {},
      children: [],
    };
    grouped.set(property, existing);

    if (rest.length === 0) {
      (existing.constraints as Record<string, string>)[
        constraintKey(error, existing.children!.length)
      ] = error.message ?? "Validation failed";
      continue;
    }

    addChildError(existing, rest, error, root, [property]);
  }

  return [...grouped.values()].map((entry) => {
    if (entry.constraints && Object.keys(entry.constraints).length === 0) delete entry.constraints;
    if (entry.children && entry.children.length === 0) delete entry.children;
    return entry;
  });
}

/**
 * Record a single constraint failure at `segments`, creating the intermediate
 * `children` entries as needed. Used by the required-property expansion, which
 * synthesizes paths that never appeared in a raw error.
 */
function recordConstraint(
  grouped: Map<string, ValidationError>,
  segments: string[],
  root: unknown,
  keyword: string,
  message: string,
): void {
  const [property, ...rest] = segments;
  if (!property) return;

  const existing = grouped.get(property) ?? {
    property,
    value: resolvePointer(root, [property]),
    constraints: {},
    children: [],
  };
  grouped.set(property, existing);

  if (rest.length === 0) {
    existing.constraints ??= {};
    (existing.constraints as Record<string, string>)[keyword] = message;
    return;
  }
  addChildError(existing, rest, { keyword, message }, root, [property]);
}

function addChildError(
  parent: ValidationError,
  path: string[],
  error: Record<string, any>,
  root: unknown,
  prefix: string[],
): void {
  const [segment, ...rest] = path;
  parent.children ??= [];
  let child = parent.children.find((entry) => entry.property === segment);
  if (!child) {
    child = {
      property: segment,
      value: "value" in error ? error.value : resolvePointer(root, [...prefix, segment!]),
      constraints: {},
      children: [],
    };
    parent.children.push(child);
  }

  if (rest.length === 0) {
    child.constraints ??= {};
    (child.constraints as Record<string, string>)[
      constraintKey(error, child.children?.length ?? 0)
    ] = error.message ?? "Validation failed";
    return;
  }

  addChildError(child, rest, error, root, [...prefix, segment!]);
}

/**
 * Key under which a failure is recorded in `constraints`.
 *
 * TypeBox 1.x supplies a descriptive string `keyword` (`"minLength"`,
 * `"type"`), which is what a consumer actually wants to branch on. TypeBox
 * 0.34 supplied a numeric `type` enum. The positional `rule_N` fallback keeps
 * distinct failures on one property from overwriting each other when neither
 * field is present.
 */
function constraintKey(error: Record<string, any>, ordinal: number): string {
  return error.keyword ?? error.type ?? `rule_${ordinal}`;
}

/** Read a value out of the validated object by property path. */
function resolvePointer(root: unknown, segments: string[]): unknown {
  let cursor = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function normalizeErrorPath(path: string | undefined): string {
  if (!path) return "";
  return path
    .replace(/^\//, "")
    .replace(/\//g, ".")
    .replace(/\[(\d+)\]/g, ".$1");
}
