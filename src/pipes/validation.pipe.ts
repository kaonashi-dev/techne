import { BadRequestException } from "../exceptions";
import type { ArgumentMetadata, PipeTransform } from "../interfaces/pipe-transform.interface";
import {
  computeAllValidationErrors,
  firstValidationError,
  hasValidationMetadata,
  isValidDto,
  plainToInstance,
  stripUnknownPropertiesWithReport,
  type ValidationError,
} from "../schema/dto";

export interface ValidationPipeOptions {
  transform?: boolean;
  whitelist?: boolean;
  forbidNonWhitelisted?: boolean;
  stopAtFirstError?: boolean;
  disableErrorMessages?: boolean;
  exceptionFactory?: (errors: any[]) => Error;
}

const PRIMITIVE_TYPES = new Set<Function>([String, Number, Boolean, Array, Object]);

/**
 * Lazy-error variant of `BadRequestException`. The pipe only materializes
 * the FIRST validation error on the throw-path (cheap); the full error list
 * is computed on demand via `lazyErrors()` — invoked by the response
 * controller / `application/problem+json` filter when it actually needs to
 * serialize the 4xx body.
 *
 * This shaves a measurable chunk off the invalid-body path because the
 * common case (a problem+json filter ignoring the list, or a caller that
 * just wants the status code) never walks the full schema.
 */
export class LazyValidationException extends BadRequestException {
  private cachedErrors?: ValidationError[];

  constructor(
    firstError: ValidationError,
    private readonly source: { value: unknown; metatype: Function },
  ) {
    // Keep the message lightweight: just the first error, JSON-stringified
    // (downstream filters that probe `.message` still see something useful).
    super(JSON.stringify([firstError]));
  }

  /** Lazily compute the full error list. Cached after the first call. */
  public lazyErrors(): ValidationError[] {
    if (this.cachedErrors) return this.cachedErrors;
    this.cachedErrors = computeAllValidationErrors(this.source.value, this.source.metatype);
    return this.cachedErrors;
  }
}

export class ValidationPipe implements PipeTransform {
  constructor(private readonly options: ValidationPipeOptions = {}) {}

  transform(value: any, metadata: ArgumentMetadata) {
    const metatype = metadata.metatype;
    if (
      !metatype ||
      PRIMITIVE_TYPES.has(metatype as Function) ||
      !hasValidationMetadata(metatype)
    ) {
      return value;
    }

    let nextValue = value;

    if (this.options.whitelist && isPlainObject(nextValue)) {
      const stripped = stripUnknownPropertiesWithReport(nextValue, metatype);
      const unknownKeys = stripped.unknownKeys;
      if (unknownKeys.length > 0 && this.options.forbidNonWhitelisted) {
        throw this.createException(
          unknownKeys.map((property) => ({
            property,
            constraints: { whitelistValidation: `${property} should not exist` },
          })),
        );
      }
      nextValue = stripped.value;
    }

    // Fast-path: most requests pass validation. `isValidDto` calls
    // `validator.Check(value)` (TypeBox's specialized predicate) without
    // materializing any error objects — zero allocation on the happy path.
    if (isValidDto(nextValue, metatype)) {
      if (this.options.transform) {
        return plainToInstance(metatype as any, nextValue);
      }
      return nextValue;
    }

    // Slow-path: validation failed. Materialize only the FIRST error.
    // The full list is lazy via `LazyValidationException.lazyErrors()`.
    const first = firstValidationError(nextValue, metatype);
    if (!first) {
      // Defensive: `Check` failed but `Errors` produced none (shouldn't
      // happen). Fall back to the eager path so we don't lose context.
      const all = computeAllValidationErrors(nextValue, metatype);
      throw this.createException(all);
    }

    // Honor the explicit `exceptionFactory` / `disableErrorMessages` /
    // `stopAtFirstError` options when set: those callers want full control
    // and may not know about `LazyValidationException`. Only emit the lazy
    // variant when the pipe is using its default settings.
    if (
      this.options.exceptionFactory ||
      this.options.disableErrorMessages ||
      this.options.stopAtFirstError
    ) {
      const errs = this.options.stopAtFirstError
        ? [first]
        : computeAllValidationErrors(nextValue, metatype);
      throw this.createException(errs);
    }

    throw new LazyValidationException(first, { value: nextValue, metatype });
  }

  private createException(errors: any[]): Error {
    if (this.options.exceptionFactory) {
      return this.options.exceptionFactory(errors);
    }

    if (this.options.disableErrorMessages) {
      return new BadRequestException();
    }

    return new BadRequestException(JSON.stringify(errors));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
