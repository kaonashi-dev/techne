import "../reflect-setup";

/**
 * NestJS-compatible `SetMetadata`. Attaches arbitrary metadata to a handler
 * method or controller class that can later be read with `Reflector`.
 *
 * ```ts
 * export const ROLES_KEY = 'roles';
 * export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
 *
 * @Controller('cats')
 * class CatsController {
 *   @Roles('admin')
 *   @Get()
 *   findAll() {}
 * }
 * ```
 */
export function SetMetadata<K = string, V = any>(
  metadataKey: K,
  metadataValue: V,
): MethodDecorator & ClassDecorator {
  const decorator = (target: any, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(metadataKey, metadataValue, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(metadataKey, metadataValue, target);
    return target;
  };
  return decorator as MethodDecorator & ClassDecorator;
}
