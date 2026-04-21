import "../reflect-setup";
import { INJECTABLE_METADATA, SCOPE_OPTIONS_METADATA } from "../common/constants";
import type { ScopeOptions } from "../core/scope";

export function Injectable(options: ScopeOptions = {}): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(INJECTABLE_METADATA, true, target);
    Reflect.defineMetadata(SCOPE_OPTIONS_METADATA, options, target);
  };
}
