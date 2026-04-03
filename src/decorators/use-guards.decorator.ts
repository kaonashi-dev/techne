import "../reflect-setup";
import { GUARDS_METADATA } from "../common/constants";

export function UseGuards(...guards: any[]): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (descriptor) {
      const existingGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, descriptor.value) || [];
      Reflect.defineMetadata(GUARDS_METADATA, [...existingGuards, ...guards], descriptor.value);
    } else {
      const existingGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, target) || [];
      Reflect.defineMetadata(GUARDS_METADATA, [...existingGuards, ...guards], target);
    }
  };
}
