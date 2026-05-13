import { PIPES_METADATA } from "../common/constants";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UsePipes(...pipes: any[]): MethodDecorator & ClassDecorator {
  return AppendArrayMetadata(PIPES_METADATA, pipes);
}
