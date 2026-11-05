import type { TSchema, Validator } from "./core/types";

/**
 * A compiled schema validator, keyed by the schema type.
 *
 * Kept as `TypeCheck` for the legacy decorator/DTO code. New code can use
 * `Validator` directly.
 */
export type TypeCheck<T extends TSchema = TSchema> = Validator<T>;

/** A schema failure reduced to the two fields Techne surfaces to callers. */
export interface SchemaIssue {
  /** JSON Pointer to the offending value, e.g. `/items/0/name`. */
  path: string;
  message: string;
}

/**
 * Normalize compiled-validator errors into {@link SchemaIssue}s.
 *
 * Techne reports the failing location as `instancePath`, following the
 * AJV/JSON-Schema convention. `path` is still read for compatibility with
 * older callers, and the rename lives in exactly one place.
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
 * Declared structurally so callers can pass any issue-shaped object. All
 * fields are optional because no single error carries all of them.
 */
interface RawSchemaError {
  instancePath?: string;
  path?: string;
  message?: string;
}
