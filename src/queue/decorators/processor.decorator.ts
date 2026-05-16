import "../../reflect-setup";
import { QUEUE_PROCESSOR_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";
import type { WorkerOptions } from "../types";

export function Processor(queueName: string, options: WorkerOptions = {}): ClassDecorator {
  return (target: Function, context?: any) => {
    const value = { queueName, options };
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, QUEUE_PROCESSOR_METADATA, value);
      return;
    }
    Reflect.defineMetadata(QUEUE_PROCESSOR_METADATA, value, target);
  };
}
