import "../reflect-setup";
import { VERSION_METADATA } from "../common/constants";
import {
  defineMetadataFromContext,
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  getOrCreateHandlerDescriptor,
  getOrCreateHandlerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";

export function Version(...versions: string[]): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: any, descriptor?: PropertyDescriptor) => {
    if (isDecoratorContext(propertyKey)) {
      if (propertyKey.kind === "class" && propertyKey.metadata) {
        defineMetadataFromContext(propertyKey.metadata, VERSION_METADATA, versions);
      } else {
        Reflect.defineMetadata(VERSION_METADATA, versions, target);
      }
      if (propertyKey.kind === "method" && propertyKey.metadata) {
        getOrCreateHandlerDescriptorFromMetadata(
          propertyKey.metadata,
          String(propertyKey.name),
        ).versions = versions;
      } else if (propertyKey.metadata) {
        getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata).versions = versions;
      }
      return;
    }

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
