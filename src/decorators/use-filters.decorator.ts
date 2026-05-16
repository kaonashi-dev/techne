import { EXCEPTION_FILTERS_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  getOrCreateHandlerDescriptor,
  getOrCreateHandlerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseFilters(...filters: any[]): MethodDecorator & ClassDecorator {
  const legacy = AppendArrayMetadata(EXCEPTION_FILTERS_METADATA, filters);
  return ((target: any, propertyKey?: any, descriptor?: PropertyDescriptor) => {
    legacy(target, propertyKey as any, descriptor as any);
    if (isDecoratorContext(propertyKey)) {
      if (propertyKey.kind === "method" && propertyKey.metadata) {
        getOrCreateHandlerDescriptorFromMetadata(
          propertyKey.metadata,
          String(propertyKey.name),
        ).filters.push(...filters);
      } else if (propertyKey.metadata) {
        getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata).filters.push(...filters);
      }
    } else if (descriptor && propertyKey != null) {
      getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).filters.push(
        ...filters,
      );
    } else {
      getOrCreateControllerDescriptor(target).filters.push(...filters);
    }
  }) as MethodDecorator & ClassDecorator;
}
