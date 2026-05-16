import { ON_RESPONSE_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateHandlerDescriptor,
} from "../core/metadata-store";
import type { ResponseHook } from "../interfaces/response-hook.interface";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

type ResponseHookType = new (...args: any[]) => ResponseHook;

export function OnResponse(
  ...hooks: (ResponseHookType | ResponseHook)[]
): MethodDecorator & ClassDecorator {
  const legacy = AppendArrayMetadata(ON_RESPONSE_METADATA, hooks);
  return ((target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    legacy(target, propertyKey as any, descriptor as any);
    if (descriptor && propertyKey != null) {
      getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).responseHooks.push(
        ...hooks,
      );
    } else {
      getOrCreateControllerDescriptor(target).responseHooks.push(...hooks);
    }
  }) as MethodDecorator & ClassDecorator;
}
