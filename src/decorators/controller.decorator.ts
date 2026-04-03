import "../reflect-setup";
import { CONTROLLER_METADATA } from "../common/constants";

export function Controller(prefixOrOptions?: string | { path?: string }): ClassDecorator {
  const prefix = typeof prefixOrOptions === "object" ? prefixOrOptions.path : prefixOrOptions;
  const path = typeof prefix === "string" ? prefix : "";
  return (target: Function) => {
    Reflect.defineMetadata(CONTROLLER_METADATA, path, target);
  };
}
