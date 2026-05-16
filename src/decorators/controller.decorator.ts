import "../reflect-setup";
import { CONTROLLER_METADATA, SCOPE_OPTIONS_METADATA } from "../common/constants";
import {
  defineMetadataFromContext,
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";
import type { ScopeOptions } from "../core/scope";

export interface ControllerOptions extends ScopeOptions {
  path?: string;
}

export function Controller(prefixOrOptions?: string | ControllerOptions): ClassDecorator {
  const prefix = typeof prefixOrOptions === "object" ? prefixOrOptions.path : prefixOrOptions;
  const path = typeof prefix === "string" ? prefix : "";
  return (target: Function, context?: any) => {
    const metadata = isDecoratorContext(context) ? context.metadata : undefined;
    if (metadata) {
      defineMetadataFromContext(metadata, CONTROLLER_METADATA, path);
    } else {
      Reflect.defineMetadata(CONTROLLER_METADATA, path, target);
    }
    if (typeof prefixOrOptions === "object") {
      const scopeOptions = { scope: prefixOrOptions.scope };
      if (metadata) {
        defineMetadataFromContext(metadata, SCOPE_OPTIONS_METADATA, scopeOptions);
      } else {
        Reflect.defineMetadata(SCOPE_OPTIONS_METADATA, scopeOptions, target);
      }
    }
    // Mirror prefix into the symbol-keyed descriptor for one-pass reads.
    const descriptor = metadata
      ? getOrCreateControllerDescriptorFromMetadata(metadata)
      : getOrCreateControllerDescriptor(target);
    descriptor.prefix = path;
  };
}
