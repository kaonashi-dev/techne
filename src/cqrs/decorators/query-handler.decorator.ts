import "../../reflect-setup";
import { QUERY_HANDLER_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

export function QueryHandler(query: any): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, QUERY_HANDLER_METADATA, query);
      return;
    }
    Reflect.defineMetadata(QUERY_HANDLER_METADATA, query, target);
  };
}
