import { BadRequestException } from "../exceptions";
import type { ArgumentMetadata, PipeTransform } from "../interfaces/pipe-transform.interface";
import {
  getUnknownPropertyKeys,
  hasValidationMetadata,
  plainToInstance,
  stripUnknownProperties,
  validateDto,
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

export class ValidationPipe implements PipeTransform {
  constructor(private readonly options: ValidationPipeOptions = {}) {}

  transform(value: any, metadata: ArgumentMetadata) {
    const metatype = metadata.metatype;
    if (!metatype || PRIMITIVE_TYPES.has(metatype as Function) || !hasValidationMetadata(metatype)) {
      return value;
    }

    let nextValue = value;

    if (this.options.whitelist && isPlainObject(nextValue)) {
      const unknownKeys = getUnknownPropertyKeys(nextValue, metatype);
      if (unknownKeys.length > 0 && this.options.forbidNonWhitelisted) {
        throw this.createException(
          unknownKeys.map((property) => ({
            property,
            constraints: { whitelistValidation: `${property} should not exist` },
          })),
        );
      }
      nextValue = stripUnknownProperties(nextValue, metatype);
    }

    const errors = validateDto(nextValue, metatype);
    if (errors.length > 0) {
      throw this.createException(
        this.options.stopAtFirstError ? [errors[0]] : errors,
      );
    }

    if (this.options.transform) {
      return plainToInstance(metatype as any, nextValue);
    }

    return nextValue;
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
