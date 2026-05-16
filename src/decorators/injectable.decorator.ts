import "../reflect-setup";
import { INJECTABLE_METADATA, SCOPE_OPTIONS_METADATA } from "../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../core/metadata-store";
import type { ScopeOptions } from "../core/scope";

export function Injectable(options: ScopeOptions = {}): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, INJECTABLE_METADATA, true);
      defineMetadataFromContext(context.metadata, SCOPE_OPTIONS_METADATA, options);
      return;
    }
    Reflect.defineMetadata(INJECTABLE_METADATA, true, target);
    Reflect.defineMetadata(SCOPE_OPTIONS_METADATA, options, target);
  };
}
