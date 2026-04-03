import "../../reflect-setup";
import { EVENT_PATTERN_METADATA } from "../../common/constants";

export function EventPattern(pattern: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const patterns: Record<string, string> =
      Reflect.getMetadata(EVENT_PATTERN_METADATA, target.constructor) || {};
    patterns[String(propertyKey)] = pattern;
    Reflect.defineMetadata(EVENT_PATTERN_METADATA, patterns, target.constructor);
  };
}
