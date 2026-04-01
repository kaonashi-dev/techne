import "reflect-metadata";
import { MIDDLEWARE_METADATA } from "../common/constants";

function _Middleware(...middlewares: any[]): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (descriptor) {
      const existingMiddlewares: any[] =
        Reflect.getMetadata(MIDDLEWARE_METADATA, descriptor.value) || [];
      Reflect.defineMetadata(
        MIDDLEWARE_METADATA,
        [...existingMiddlewares, ...middlewares],
        descriptor.value,
      );
    } else {
      const existingMiddlewares: any[] = Reflect.getMetadata(MIDDLEWARE_METADATA, target) || [];
      Reflect.defineMetadata(MIDDLEWARE_METADATA, [...existingMiddlewares, ...middlewares], target);
    }
  };
}

export const Middleware = _Middleware;
export const Use = _Middleware;
