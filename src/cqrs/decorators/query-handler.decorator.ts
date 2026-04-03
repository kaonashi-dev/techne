import "../../reflect-setup";
import { QUERY_HANDLER_METADATA } from "../../common/constants";

export function QueryHandler(query: any): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(QUERY_HANDLER_METADATA, query, target);
  };
}
