import "../../reflect-setup";
import { MQ_DEFAULT_TRIES } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

/** Set the default maximum attempt count for a `Dispatchable` subclass. */
export function Tries(attempts: number): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_DEFAULT_TRIES, attempts);
      return;
    }
    Reflect.defineMetadata(MQ_DEFAULT_TRIES, attempts, target);
  };
}
