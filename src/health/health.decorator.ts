import { SetMetadata } from "../decorators/set-metadata.decorator";

export const HEALTH_CHECK_METADATA = "__health_check__";

export function HealthCheck(): MethodDecorator & ClassDecorator {
  return SetMetadata(HEALTH_CHECK_METADATA, true);
}
