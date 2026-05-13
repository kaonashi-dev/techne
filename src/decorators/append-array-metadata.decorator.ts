import "../reflect-setup";

export function AppendArrayMetadata<T = any>(
  metadataKey: string,
  metadataValues: T[],
): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    const metadataTarget = descriptor ? descriptor.value : target;
    const existing: T[] = Reflect.getMetadata(metadataKey, metadataTarget) || [];

    Reflect.defineMetadata(metadataKey, [...existing, ...metadataValues], metadataTarget);
  };
}
