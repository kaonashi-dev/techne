import "../reflect-setup";
import { CATCH_METADATA } from "../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../core/metadata-store";

/**
 * Techne `@Catch` decorator. Declares the exception types an
 * `ExceptionFilter` handles. `@Catch()` with no arguments = catch-all
 * (the default Techne catch-all behavior).
 *
 * ```ts
 * @Catch(BadRequestException)
 * class BadRequestFilter implements ExceptionFilter {
 *   catch(exception: BadRequestException, host: ArgumentsHost) { ... }
 * }
 * ```
 */
export function Catch(...exceptionTypes: Function[]): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, CATCH_METADATA, exceptionTypes);
      return;
    }
    Reflect.defineMetadata(CATCH_METADATA, exceptionTypes, target);
  };
}
