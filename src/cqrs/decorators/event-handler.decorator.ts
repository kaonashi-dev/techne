import "../../reflect-setup";
import { EVENT_HANDLER_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

export function EventHandler(event: any): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, EVENT_HANDLER_METADATA, event);
      return;
    }
    Reflect.defineMetadata(EVENT_HANDLER_METADATA, event, target);
  };
}
