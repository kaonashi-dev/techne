import type { TSchema } from "typebox";
import type { Validator } from "typebox/compile";

/**
 * A compiled schema validator, keyed by the schema type.
 *
 * TypeBox 0.34 exposed this as `TypeCheck<T extends TSchema>` from
 * `@sinclair/typebox/compiler`. TypeBox 1.x renamed it to `Validator` and
 * reordered the generics so the *context* (the set of named definitions a
 * schema may reference) comes first and the schema second:
 *
 *   Validator<Context extends TProperties, Type extends TSchema, ...>
 *
 * This alias restores the schema-first arity the codebase reads more naturally,
 * defaulting the context slot. Techne compiles self-contained schemas — nothing
 * here uses cross-schema `Ref` definitions — so the default empty context is
 * correct rather than merely convenient.
 */
export type TypeCheck<T extends TSchema = TSchema> = Validator<{}, T>;

/** A schema failure reduced to the two fields Techne surfaces to callers. */
export interface SchemaIssue {
  /** JSON Pointer to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

/**
 * Normalize compiled-validator errors into {@link SchemaIssue}s.
 *
 * TypeBox 1.x reports the failing location as `instancePath`, following the
 * AJV/JSON-Schema convention; TypeBox 0.34 called it `path`. Both are read so
 * the helper stays correct regardless of which produced the error, and so the
 * rename lives in exactly one place instead of at every call site.
 */
export function toSchemaIssues(errors: Iterable<RawSchemaError>): SchemaIssue[] {
  const out: SchemaIssue[] = [];
  for (const error of errors) {
    out.push({
      path: error.instancePath ?? error.path ?? "",
      message: error.message ?? "Validation failed",
    });
  }
  return out;
}

/**
 * The subset of a validator error this module reads.
 *
 * Declared structurally rather than as TypeBox's concrete error union: that
 * union is a discriminated set of interfaces without an index signature, so it
 * is not assignable to `Record<string, unknown>`. All fields are optional
 * because no single member of the union carries all of them.
 */
interface RawSchemaError {
  instancePath?: string;
  path?: string;
  message?: string;
}
