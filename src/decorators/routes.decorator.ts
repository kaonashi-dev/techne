import "../reflect-setup";
import { ROUTES_METADATA } from "../common/constants";
import type { TSchema } from "@sinclair/typebox";

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteMetadata {
  path: string;
  method: RequestMethod;
  handlerName: string;
  schema?: {
    body?: TSchema;
    query?: TSchema;
    params?: TSchema;
    response?: TSchema;
  };
}

const createRouteDecorator = (method: RequestMethod) => {
  return (path: string = "/", schema?: RouteMetadata["schema"]): any => {
    return (target: any, propertyKey: string, _descriptor: PropertyDescriptor) => {
      const routes: RouteMetadata[] =
        Reflect.getMetadata(ROUTES_METADATA, target.constructor) || [];
      routes.push({
        path,
        method,
        handlerName: String(propertyKey),
        schema,
      });
      Reflect.defineMetadata(ROUTES_METADATA, routes, target.constructor);
    };
  };
};

export const Get = createRouteDecorator("GET");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");
export const Patch = createRouteDecorator("PATCH");
export const Delete = createRouteDecorator("DELETE");
