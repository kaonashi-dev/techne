import "../../reflect-setup";
import { MQ_PROCESSOR_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";
import type { WorkerOptions } from "../types";

export function MqProcessor(queueName: string, options: WorkerOptions = {}): ClassDecorator {
  return (target: Function, context?: any) => {
    const value = { queueName, options };
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_PROCESSOR_METADATA, value);
      return;
    }
    Reflect.defineMetadata(MQ_PROCESSOR_METADATA, value, target);
  };
}
