import { GUARDS_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateHandlerDescriptor,
} from "../core/metadata-store";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseGuards(...guards: any[]): MethodDecorator & ClassDecorator {
  const legacy = AppendArrayMetadata(GUARDS_METADATA, guards);
  return ((target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    legacy(target, propertyKey as any, descriptor as any);
    if (descriptor && propertyKey != null) {
      getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).guards.push(...guards);
    } else {
      getOrCreateControllerDescriptor(target).guards.push(...guards);
    }
  }) as MethodDecorator & ClassDecorator;
}
