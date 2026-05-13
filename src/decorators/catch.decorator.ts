import "../reflect-setup";
import { CATCH_METADATA } from "../common/constants";

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
  return (target: Function) => {
    Reflect.defineMetadata(CATCH_METADATA, exceptionTypes, target);
  };
}
