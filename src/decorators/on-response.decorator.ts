import { ON_RESPONSE_METADATA } from "../common/constants";
import type { ResponseHook } from "../interfaces/response-hook.interface";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

type ResponseHookType = new (...args: any[]) => ResponseHook;

export function OnResponse(
  ...hooks: (ResponseHookType | ResponseHook)[]
): MethodDecorator & ClassDecorator {
  return AppendArrayMetadata(ON_RESPONSE_METADATA, hooks);
}
