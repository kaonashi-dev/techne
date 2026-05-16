import { GUARDS_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  getOrCreateHandlerDescriptor,
  getOrCreateHandlerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseGuards(...guards: any[]): MethodDecorator & ClassDecorator {
  const legacy = AppendArrayMetadata(GUARDS_METADATA, guards);
  return ((target: any, propertyKey?: any, descriptor?: PropertyDescriptor) => {
    legacy(target, propertyKey as any, descriptor as any);
    if (isDecoratorContext(propertyKey)) {
      if (propertyKey.kind === "method" && propertyKey.metadata) {
        getOrCreateHandlerDescriptorFromMetadata(
          propertyKey.metadata,
          String(propertyKey.name),
        ).guards.push(...guards);
      } else if (propertyKey.metadata) {
        getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata).guards.push(...guards);
      }
    } else if (descriptor && propertyKey != null) {
      getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).guards.push(...guards);
    } else {
      getOrCreateControllerDescriptor(target).guards.push(...guards);
    }
  }) as MethodDecorator & ClassDecorator;
}
