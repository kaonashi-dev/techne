import "../reflect-setup";
import { ROUTES_METADATA, SINGLE_ACTION_HANDLER } from "../common/constants";
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
      // A verb decorator placed on the class itself (rather than a method)
      // declares a single-action controller: its lone route binds to a
      // conventional `handle` method.  Legacy class decorators are invoked as
      // `decorator(target)` with no propertyKey; stage-3 reports kind "class".
      const isClassLevel = stage3 ? propertyKey.kind === "class" : propertyKey === undefined;
      const classRef = isClassLevel ? target : target.constructor;
      const handlerName = isClassLevel
        ? SINGLE_ACTION_HANDLER
        : stage3
          ? String(propertyKey.name)
          : String(propertyKey);

      if (isClassLevel && typeof classRef?.prototype?.[handlerName] !== "function") {
        throw new Error(
          `Single-action controller "${classRef?.name ?? "<anonymous>"}" is missing a "${handlerName}" method.`,
        );
      }

      const route: RouteMetadata = {
        path,
        method,
        handlerName,
        schema,
      };
      if (!stage3) {
        const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA, classRef) || [];
        routes.push(route);
        Reflect.defineMetadata(ROUTES_METADATA, routes, classRef);
      }
      // Mirror onto the controller descriptor.  Other decorators on the same
      // method push into the same `handlers[name]` slot — keep them aligned.
      const descriptor =
        stage3 && propertyKey.metadata
          ? getOrCreateControllerDescriptorFromMetadata(propertyKey.metadata)
          : getOrCreateControllerDescriptor(classRef);
      descriptor.routes.push(route);
    };
  };
};

export const Get = createRouteDecorator("GET");
export const Post = createRouteDecorator("POST");
export const Put = createRouteDecorator("PUT");
export const Patch = createRouteDecorator("PATCH");
export const Delete = createRouteDecorator("DELETE");
