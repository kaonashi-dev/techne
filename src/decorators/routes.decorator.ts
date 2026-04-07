import "../reflect-setup";
import { ROUTES_METADATA } from "../common/constants";

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
