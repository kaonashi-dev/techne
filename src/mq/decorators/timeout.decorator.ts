import "../../reflect-setup";
import { MQ_DEFAULT_TIMEOUT } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

/** Set the default per-job timeout (ms) for a `Dispatchable` subclass. */
export function Timeout(milliseconds: number): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_DEFAULT_TIMEOUT, milliseconds);
      return;
    }
    Reflect.defineMetadata(MQ_DEFAULT_TIMEOUT, milliseconds, target);
  };
}
