import "../../reflect-setup";
import { QUEUE_PROCESS_METADATA } from "../../common/constants";

export function Process(name?: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const existing = Reflect.getMetadata(QUEUE_PROCESS_METADATA, target.constructor) || {};
    existing[String(propertyKey)] = name;
    Reflect.defineMetadata(QUEUE_PROCESS_METADATA, existing, target.constructor);
  };
}
