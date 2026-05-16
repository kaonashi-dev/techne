import "../reflect-setup";
import { VERSION_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateHandlerDescriptor,
} from "../core/metadata-store";

export function Version(...versions: string[]): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(VERSION_METADATA, versions, descriptor.value);
      if (propertyKey != null) {
        getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).versions = versions;
      }
      return descriptor;
    }

    Reflect.defineMetadata(VERSION_METADATA, versions, target);
    getOrCreateControllerDescriptor(target).versions = versions;
    return target;
  };
}
