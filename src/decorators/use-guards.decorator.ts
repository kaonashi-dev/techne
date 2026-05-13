import { GUARDS_METADATA } from "../common/constants";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseGuards(...guards: any[]): MethodDecorator & ClassDecorator {
  return AppendArrayMetadata(GUARDS_METADATA, guards);
}
