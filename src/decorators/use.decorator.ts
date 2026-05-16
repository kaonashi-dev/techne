import "../reflect-setup";
import { MIDDLEWARE_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateHandlerDescriptor,
} from "../core/metadata-store";

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
      if (propertyKey != null) {
        getOrCreateHandlerDescriptor(target.constructor, String(propertyKey)).middlewares.push(
          ...middlewares,
        );
      }
    } else {
      const existingMiddlewares: any[] = Reflect.getMetadata(MIDDLEWARE_METADATA, target) || [];
      Reflect.defineMetadata(MIDDLEWARE_METADATA, [...existingMiddlewares, ...middlewares], target);
      getOrCreateControllerDescriptor(target).middlewares.push(...middlewares);
    }
  };
}

export const Middleware = _Middleware;
export const Use = _Middleware;
