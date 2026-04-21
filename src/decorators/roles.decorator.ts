import { SetMetadata } from "./set-metadata.decorator";
import { ROLES_METADATA } from "../common/constants";

export function Roles(...roles: string[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_METADATA, roles);
}
