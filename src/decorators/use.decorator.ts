import "../reflect-setup";
import { MIDDLEWARE_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  getOrCreateHandlerDescriptor,
  getOrCreateHandlerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";

function _Middleware(...middlewares: any[]): MethodDecorator & ClassDecorator {
  return (target: any, propertyKey?: any, descriptor?: TypedPropertyDescriptor<any>) => {
    if (isDecoratorContext(propertyKey)) {
      const existingMiddlewares: any[] = Reflect.getMetadata(MIDDLEWARE_METADATA, target) || [];
      Reflect.defineMetadata(MIDDLEWARE_METADATA, [...existingMiddlewares, ...middlewares], target);
      if (propertyKey.kind === "method" && propertyKey.metadata) {
        getOrCreateHandlerDescriptorFromMetadata(
          propertyKey.metadata,
          String(propertyKey.name),
        ).middlewares.push(...middlewares);
      } else if (propertyKey.metadata) {
        getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata).middlewares.push(
          ...middlewares,
        );
      }
      return;
    }

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
