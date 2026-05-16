import "../../reflect-setup";
import { COMMAND_HANDLER_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

export function CommandHandler(command: any): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, COMMAND_HANDLER_METADATA, command);
      return;
    }
    Reflect.defineMetadata(COMMAND_HANDLER_METADATA, command, target);
  };
}
