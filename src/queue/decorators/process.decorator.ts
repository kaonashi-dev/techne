import "../../reflect-setup";
import { QUEUE_PROCESS_METADATA } from "../../common/constants";
import {
  defineMetadataFromContext,
  getMetadataFromContext,
  isDecoratorContext,
} from "../../core/metadata-store";

export function Process(name?: string): MethodDecorator {
  return (target: object, propertyKey: any, _descriptor?: PropertyDescriptor) => {
    if (isDecoratorContext(propertyKey) && propertyKey.metadata) {
      const existing =
        getMetadataFromContext<Record<string, string | undefined>>(
          propertyKey.metadata,
          QUEUE_PROCESS_METADATA,
        ) || {};
      existing[String(propertyKey.name)] = name;
      defineMetadataFromContext(propertyKey.metadata, QUEUE_PROCESS_METADATA, existing);
      return;
    }
    const existing = Reflect.getMetadata(QUEUE_PROCESS_METADATA, target.constructor) || {};
    existing[String(propertyKey)] = name;
    Reflect.defineMetadata(QUEUE_PROCESS_METADATA, existing, target.constructor);
  };
}
