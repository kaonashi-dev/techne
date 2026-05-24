import "../../reflect-setup";
import { MQ_DEFAULT_QUEUE } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

/** Override the destination queue name for a `Dispatchable` subclass at dispatch time. */
export function OnQueue(queueName: string): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_DEFAULT_QUEUE, queueName);
      return;
    }
    Reflect.defineMetadata(MQ_DEFAULT_QUEUE, queueName, target);
  };
}
