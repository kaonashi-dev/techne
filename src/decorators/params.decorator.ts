import "../reflect-setup";
import { PARAMS_METADATA } from "../common/constants";
import { getOrCreateControllerDescriptor } from "../core/metadata-store";
import type { ResponseHookContext } from "../interfaces/response-hook.interface";

export type ParamType = "body" | "param" | "query" | "headers" | "request" | "file" | "custom";

/** Factory signature used by `createParamDecorator`. */
export type CustomParamFactory<TData = any, TOutput = any> = (
  data: TData,
  ctx: ResponseHookContext,
) => TOutput;

export interface ParamMetadata {
  index: number;
  type: ParamType;
  name?: string;
  /** DTO class passed to `@Body(MyDto)` — used to auto-inject the TypeBox schema. */
  dtoClass?: Function;
  /** Reflected parameter type for `@Body() dto: CreateDto`. */
  metatype?: Function;
  /** Factory for params created with `createParamDecorator`. */
  factory?: CustomParamFactory;
  /** Static data passed to the factory as its first argument. */
  data?: unknown;
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
  // Keep the same map reference on the descriptor so subsequent param
  // decorators on the same handler append in place.
  getOrCreateControllerDescriptor((target as any).constructor).paramsByHandler = params;
}

const createBuiltinParamDecorator = (type: ParamType) => {
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

export const Param = createBuiltinParamDecorator("param");
export const Query = createBuiltinParamDecorator("query");
export const Headers = createBuiltinParamDecorator("headers");
export const UploadedFile = createBuiltinParamDecorator("file");

/**
 * Techne custom parameter decorator helper. Given a factory that reads from
 * the route context, returns a parameter decorator that injects the
 * factory's return value into a handler argument at request time.
 *
 * ```ts
 * export const CurrentUser = createParamDecorator(
 *   (data: string | undefined, ctx) => {
 *     const req = ctx.ctx.request;
 *     return data ? req.user?.[data] : req.user;
 *   },
 * );
 *
 * @Get('me')
 * profile(@CurrentUser() user: User) {}
 * ```
 */
export function createParamDecorator<TData = any, TOutput = any>(
  factory: CustomParamFactory<TData, TOutput>,
): (data?: TData) => ParameterDecorator {
  return (data?: TData): ParameterDecorator => {
    return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
      if (!propertyKey) return;
      const key = global.String(propertyKey);
      _addParam(target, key, parameterIndex, {
        type: "custom",
        factory: factory as CustomParamFactory,
        data,
        metatype: getParameterMetatype(target, key, parameterIndex),
      });
    };
  };
}

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
