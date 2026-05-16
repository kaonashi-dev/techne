import "../reflect-setup";
import { ROUTES_METADATA } from "../common/constants";
import {
  getOrCreateControllerDescriptor,
  getOrCreateControllerDescriptorFromMetadata,
  isDecoratorContext,
} from "../core/metadata-store";

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteSchema = {
  body?: unknown;
  query?: unknown;
  params?: unknown;
  response?: unknown;
};

export interface RouteMetadata {
  path: string;
  method: RequestMethod;
  handlerName: string;
  schema?: RouteSchema;
}

const createRouteDecorator = (method: RequestMethod) => {
  return (path: string = "/", schema?: RouteMetadata["schema"]): any => {
    return (target: any, propertyKey: any, _descriptor?: PropertyDescriptor) => {
      const stage3 = isDecoratorContext(propertyKey);
      const handlerName = stage3 ? String(propertyKey.name) : String(propertyKey);
      const route: RouteMetadata = {
        path,
        method,
        handlerName,
        schema,
      };
      if (!stage3) {
        const routes: RouteMetadata[] =
          Reflect.getMetadata(ROUTES_METADATA, target.constructor) || [];
        routes.push(route);
        Reflect.defineMetadata(ROUTES_METADATA, routes, target.constructor);
      }
      // Mirror onto the controller descriptor.  Other decorators on the same
      // method push into the same `handlers[name]` slot — keep them aligned.
      const descriptor =
        stage3 && propertyKey.metadata
          ? getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata)
          : getOrCreateControllerDescriptor(target.constructor);
      descriptor.routes.push(route);
    };
  };
};

export const Get = createRouteDecorator("GET");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");
export const Patch = createRouteDecorator("PATCH");
export const Delete = createRouteDecorator("DELETE");
