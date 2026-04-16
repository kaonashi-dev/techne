import "../../reflect-setup";
import { MQ_PROCESS_METADATA } from "../../common/constants";

export function MqProcess(name?: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const existing = Reflect.getMetadata(MQ_PROCESS_METADATA, target.constructor) || {};
    existing[String(propertyKey)] = name;
    Reflect.defineMetadata(MQ_PROCESS_METADATA, existing, target.constructor);
  };
}
