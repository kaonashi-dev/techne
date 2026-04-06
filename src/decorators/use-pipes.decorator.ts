import "../reflect-setup";
import { PIPES_METADATA } from "../common/constants";

export function UsePipes(...pipes: any[]): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (descriptor) {
      const existing: any[] = Reflect.getMetadata(PIPES_METADATA, descriptor.value) || [];
      Reflect.defineMetadata(PIPES_METADATA, [...existing, ...pipes], descriptor.value);
    } else {
      const existing: any[] = Reflect.getMetadata(PIPES_METADATA, target) || [];
      Reflect.defineMetadata(PIPES_METADATA, [...existing, ...pipes], target);
    }
  };
}
