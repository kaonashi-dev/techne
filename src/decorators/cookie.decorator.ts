import "../reflect-setup";
import { PARAMS_METADATA } from "../common/constants";
import { getOrCreateControllerDescriptor } from "../core/metadata-store";

function _addCookieParam(
  target: object,
  propertyKey: string,
  parameterIndex: number,
  cookieName: string,
): void {
  const params: Record<string, any[]> =
    Reflect.getMetadata(PARAMS_METADATA, (target as any).constructor) ?? {};
  const methodParams = params[propertyKey] ?? [];

  methodParams.push({
    index: parameterIndex,
    type: "cookie",
    name: cookieName,
  });
  params[propertyKey] = methodParams;

  Reflect.defineMetadata(PARAMS_METADATA, params, (target as any).constructor);
  getOrCreateControllerDescriptor((target as any).constructor).paramsByHandler = params;
}

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
    const key = global.String(propertyKey);
    _addCookieParam(target, key, parameterIndex, name);
  };
}
