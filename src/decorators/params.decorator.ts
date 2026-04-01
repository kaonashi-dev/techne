import "reflect-metadata";
import { PARAMS_METADATA } from "../common/constants";

export type ParamType = "body" | "param" | "query";

export interface ParamMetadata {
  index: number;
  type: ParamType;
  name?: string;
}

const createParamDecorator = (type: ParamType) => {
  return (name?: string): ParameterDecorator => {
    return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      if (!propertyKey) return; // Only apply to methods

      const params: Record<string, ParamMetadata[]> =
        Reflect.getMetadata(PARAMS_METADATA, target.constructor) || {};
      const methodParams = params[String(propertyKey)] || [];

      methodParams.push({
        index: parameterIndex,
        type,
        name,
      });

      params[String(propertyKey)] = methodParams;
      Reflect.defineMetadata(PARAMS_METADATA, params, target.constructor);
    };
  };
};

export const Body = createParamDecorator("body");
export const Param = createParamDecorator("param");
export const Query = createParamDecorator("query");
