import { EXCEPTION_FILTERS_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateHandlerDescriptor,
} from "../core/metadata-store";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseFilters(...filters: any[]): MethodDecorator & ClassDecorator {
  const legacy = AppendArrayMetadata(EXCEPTION_FILTERS_METADATA, filters);
  return ((target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    legacy(target, propertyKey as any, descriptor as any);
    if (descriptor && propertyKey != null) {
      getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).filters.push(
        ...filters,
      );
    } else {
      getOrCreateControllerDescriptor(target).filters.push(...filters);
    }
  }) as MethodDecorator & ClassDecorator;
}
