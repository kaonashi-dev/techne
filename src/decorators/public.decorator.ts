import { SetMetadata } from "./set-metadata.decorator";
import { PUBLIC_METADATA } from "../common/constants";

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_METADATA, true);
}
