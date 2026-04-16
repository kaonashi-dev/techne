import "../reflect-setup";
import { CONTROLLER_METADATA, SCOPE_OPTIONS_METADATA } from "../common/constants";
import type { ScopeOptions } from "../core/scope";

export interface ControllerOptions extends ScopeOptions {
  path?: string;
}

export function Controller(prefixOrOptions?: string | ControllerOptions): ClassDecorator {
  const prefix = typeof prefixOrOptions === "object" ? prefixOrOptions.path : prefixOrOptions;
  const path = typeof prefix === "string" ? prefix : "";
  return (target: Function) => {
    Reflect.defineMetadata(CONTROLLER_METADATA, path, target);
    if (typeof prefixOrOptions === "object") {
      Reflect.defineMetadata(SCOPE_OPTIONS_METADATA, { scope: prefixOrOptions.scope }, target);
    }
  };
}
