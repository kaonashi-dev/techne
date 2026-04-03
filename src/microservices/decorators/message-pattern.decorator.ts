import "../../reflect-setup";
import { MESSAGE_PATTERN_METADATA } from "../../common/constants";

export function MessagePattern(pattern: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const patterns: Record<string, string> =
      Reflect.getMetadata(MESSAGE_PATTERN_METADATA, target.constructor) || {};
    patterns[String(propertyKey)] = pattern;
    Reflect.defineMetadata(MESSAGE_PATTERN_METADATA, patterns, target.constructor);
  };
}
