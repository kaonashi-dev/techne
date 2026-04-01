import "reflect-metadata";
import { INJECT_METADATA } from "../common/constants";

export function Inject(token: any): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existingInjections = Reflect.getMetadata(INJECT_METADATA, target) || {};
    existingInjections[parameterIndex] = token;
    Reflect.defineMetadata(INJECT_METADATA, existingInjections, target);
  };
}
