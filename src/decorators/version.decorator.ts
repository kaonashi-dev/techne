import "../reflect-setup";
import { VERSION_METADATA } from "../common/constants";

export function Version(...versions: string[]): MethodDecorator & ClassDecorator {
  return (target: any, _propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(VERSION_METADATA, versions, descriptor.value);
      return descriptor;
    }

    Reflect.defineMetadata(VERSION_METADATA, versions, target);
    return target;
  };
}
