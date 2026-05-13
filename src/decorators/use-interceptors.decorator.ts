import { INTERCEPTORS_METADATA } from "../common/constants";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseInterceptors(...interceptors: any[]): MethodDecorator & ClassDecorator {
  return AppendArrayMetadata(INTERCEPTORS_METADATA, interceptors);
}
