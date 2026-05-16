import "../reflect-setup";
import { defineMetadataFromContext, isDecoratorContext } from "../core/metadata-store";

/**
 * Techne `SetMetadata` helper. Attaches arbitrary metadata to a handler
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
export function SetMetadata<K extends PropertyKey = string, V = any>(
  metadataKey: K,
  metadataValue: V,
): MethodDecorator & ClassDecorator {
  const decorator = (target: any, key?: any, descriptor?: PropertyDescriptor) => {
    if (isDecoratorContext(key)) {
      if (key.kind === "class" && key.metadata) {
        defineMetadataFromContext(key.metadata, metadataKey as string, metadataValue);
      } else {
        Reflect.defineMetadata(metadataKey as string, metadataValue, target);
      }
      return;
    }

    if (descriptor) {
      Reflect.defineMetadata(metadataKey as string, metadataValue, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(metadataKey as string, metadataValue, target);
    return target;
  };
  return decorator as MethodDecorator & ClassDecorator;
}
