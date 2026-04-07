import { Inject } from "../../decorators/inject.decorator";
import { getQueueToken } from "../tokens";

export function InjectQueue(name: string): ParameterDecorator {
  return Inject(getQueueToken(name));
}
