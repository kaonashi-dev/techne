import "../reflect-setup";
import { PARAMS_METADATA } from "../common/constants";
import { getOrCreateControllerDescriptor } from "../core/metadata-store";
import type { ResponseHookContext } from "../interfaces/response-hook.interface";

export type ParamType =
  | "body"
  | "param"
  | "query"
  | "headers"
  | "request"
  | "file"
  | "custom"
  | "cookie";

/** Factory signature used by `createParamDecorator`. */
export type CustomParamFactory<TData = any, TOutput = any> = (
  data: TData,
  ctx: ResponseHookContext,
) => TOutput;

/** Options for `@UploadedFile` upload validation. */
export interface UploadedFileOptions {
  /**
   * Maximum allowed file size in bytes. Requests with a larger file are
   * rejected with HTTP 422.
   */
  maxSize?: number;
  /**
   * Allowed MIME types. Supports exact strings (`"image/png"`) and wildcard
   * sub-type notation (`"image/*"`). Requests with a non-matching content type
   * are rejected with HTTP 422.
   *
   * **Note:** the MIME type is client-declared (`file.type`) and is NOT
   * verified against the file's magic bytes.
   */
  mimeTypes?: string[];
  /**
   * When `true` (default), the upload is required — a missing file yields HTTP
   * 422. Set to `false` to make the upload optional.
   */
  required?: boolean;
}

export interface ParamMetadata {
  index: number;
  type: ParamType;
  name?: string;
  /** DTO class passed to `@Body(MyDto)` — used to auto-inject the TypeBox schema. */
  dtoClass?: Function;
  /**
   * DTO class passed to `@Headers(DtoClass)` — used to auto-inject the header
   * TypeBox schema (additionalProperties: true, lowercased keys).
   */
  headerDtoClass?: Function;
  /** Reflected parameter type for `@Body() dto: CreateDto`. */
  metatype?: Function;
  /** Factory for params created with `createParamDecorator`. */
  factory?: CustomParamFactory;
  /** Static data passed to the factory as its first argument. */
  data?: unknown;
  /** Validation options for `@UploadedFile`. */
  fileOptions?: UploadedFileOptions;
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

/** @internal Shared by every param decorator (including `@Cookie`). */
export function _addParam(
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

/**
 * Binds request headers (or a single header value) to a handler parameter.
 *
 * Overloads:
 * - `@Headers()`           — whole `ctx.headers` object
 * - `@Headers('x-api-key')` — single header value
 * - `@Headers(AuthHeaders)` — whole headers object + auto-injects the DTO's
 *                             TypeBox schema (additionalProperties: true,
 *                             lowercased keys) into Elysia's header validation
 */
export function Headers(nameOrDto?: string | Function): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    const key = global.String(propertyKey);
    const metatype = getParameterMetatype(target, key, parameterIndex);

    if (typeof nameOrDto === "function") {
      // Called as @Headers(DtoClass)
      _addParam(target, key, parameterIndex, {
        type: "headers",
        headerDtoClass: nameOrDto,
        metatype,
      });
    } else {
      // Called as @Headers() or @Headers('header-name')
      _addParam(target, key, parameterIndex, { type: "headers", name: nameOrDto, metatype });
    }
  };
}

/**
 * Binds an uploaded file from the multipart body to a handler parameter.
 *
 * Overloads:
 * - `@UploadedFile()`              — first file in the body
 * - `@UploadedFile("avatar")`      — named field
 * - `@UploadedFile("avatar", opts)` — named field + validation constraints
 *
 * Validation constraints (all optional):
 * - `maxSize`: maximum file size in bytes
 * - `mimeTypes`: exact MIME types or `"type/*"` wildcards
 * - `required`: defaults to `true`; set `false` to make the file optional
 */
export function UploadedFile(name?: string, options?: UploadedFileOptions): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    if (!propertyKey) return;
    const key = global.String(propertyKey);
    const metatype = getParameterMetatype(target, key, parameterIndex);
    _addParam(target, key, parameterIndex, {
      type: "file",
      name,
      metatype,
      fileOptions: options,
    });
  };
}

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
