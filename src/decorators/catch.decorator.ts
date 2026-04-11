import "../reflect-setup";
import { CATCH_METADATA } from "../common/constants";

/**
 * NestJS-compatible `@Catch` decorator. Declares the exception types an
 * `ExceptionFilter` handles. `@Catch()` with no arguments = catch-all
 * (the existing Bnest default).
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
