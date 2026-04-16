import { Inject } from "../../decorators/inject.decorator";
import { getMqToken } from "../tokens";

export function InjectMq(name: string): ParameterDecorator {
  return Inject(getMqToken(name));
}
