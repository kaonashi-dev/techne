import "../reflect-setup";
import { _addParam } from "./params.decorator";

/**
 * Extracts a named cookie value from the incoming request.
 *
 * ```ts
 * @Get('/profile')
 * profile(@Cookie('session') session: string | undefined) {}
 * ```
 */
export function Cookie(name: string): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    _addParam(target, global.String(propertyKey), parameterIndex, { type: "cookie", name });
  };
}
