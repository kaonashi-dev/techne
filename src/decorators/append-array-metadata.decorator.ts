import "../reflect-setup";
import {
  defineMetadataFromContext,
  getMetadataFromContext,
  isDecoratorContext,
} from "../core/metadata-store";

export function AppendArrayMetadata<T = any>(
  metadataKey: string,
  metadataValues: T[],
): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol | { kind: string },
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (isDecoratorContext(propertyKey)) {
      if (propertyKey.kind === "class" && propertyKey.metadata) {
        const existing = getMetadataFromContext<T[]>(propertyKey.metadata, metadataKey) || [];
        const next = [...existing, ...metadataValues];
        defineMetadataFromContext(propertyKey.metadata, metadataKey, next);
      } else {
        const existing: T[] = Reflect.getMetadata(metadataKey, target) || [];
        const next = [...existing, ...metadataValues];
        Reflect.defineMetadata(metadataKey, next, target);
      }
      return;
    }

    const metadataTarget = descriptor ? descriptor.value : target;
    const existing: T[] = Reflect.getMetadata(metadataKey, metadataTarget) || [];

    Reflect.defineMetadata(metadataKey, [...existing, ...metadataValues], metadataTarget);
  };
}
