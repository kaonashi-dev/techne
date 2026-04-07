import "../reflect-setup";
import { PARAMS_METADATA } from "../common/constants";

export type ParamType = "body" | "param" | "query" | "headers" | "request";

export interface ParamMetadata {
  index: number;
  type: ParamType;
  name?: string;
  /** DTO class passed to `@Body(MyDto)` — used to auto-inject the TypeBox schema. */
  dtoClass?: Function;
  /** Reflected parameter type for `@Body() dto: CreateDto`. */
  metatype?: Function;
}

function getParameterMetatype(
  target: object,
  propertyKey: string,
  parameterIndex: number,
): Function | undefined {
  const paramTypes = Reflect.getMetadata("design:paramtypes", target, propertyKey) as
    | Function[]
    | undefined;
  return paramTypes?.[parameterIndex];
}

function _addParam(
  target: object,
  propertyKey: string,
  parameterIndex: number,
  meta: Omit<ParamMetadata, "index">,
): void {
  const params: Record<string, ParamMetadata[]> =
    Reflect.getMetadata(PARAMS_METADATA, (target as any).constructor) ?? {};
  const methodParams = params[propertyKey] ?? [];

  methodParams.push({ index: parameterIndex, ...meta });
  params[propertyKey] = methodParams;

  Reflect.defineMetadata(PARAMS_METADATA, params, (target as any).constructor);
}

const createParamDecorator = (type: ParamType) => {
  return (name?: string): ParameterDecorator => {
    return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      if (!propertyKey) return;
      const key = global.String(propertyKey);
      _addParam(target, key, parameterIndex, {
        type,
        name,
        metatype: getParameterMetatype(target, key, parameterIndex),
      });
    };
  };
};

/**
 * Binds the request body (or a field within it) to a handler parameter.
 *
 * Overloads:
 * - `@Body()`           — whole body, no automatic schema injection
 * - `@Body('field')`    — `body.field`
 * - `@Body(CreateDto)`  — whole body + auto-injects the DTO's TypeBox schema
 *                         into Elysia's validation for this route
 */
export function Body(nameOrDto?: string | Function): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    const key = global.String(propertyKey);
    const metatype = getParameterMetatype(target, key, parameterIndex);

    if (typeof nameOrDto === "function") {
      // Called as @Body(MyDto)
      _addParam(target, key, parameterIndex, { type: "body", dtoClass: nameOrDto, metatype });
    } else {
      // Called as @Body() or @Body('fieldName')
      _addParam(target, key, parameterIndex, { type: "body", name: nameOrDto, metatype });
    }
  };
}

export const Param = createParamDecorator("param");
export const Query = createParamDecorator("query");
export const Headers = createParamDecorator("headers");

/** Injects the raw `Request` object into a handler parameter. */
export function Req(): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    const key = global.String(propertyKey);
    _addParam(target, key, parameterIndex, {
      type: "request",
      metatype: getParameterMetatype(target, key, parameterIndex),
    });
  };
}
