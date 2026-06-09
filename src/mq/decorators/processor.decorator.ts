import "../../reflect-setup";
import { MQ_PROCESSOR_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";
import type { QueueDef } from "../define-queue";
import type { WorkerOptions } from "../types";
import { MqProcessor } from "./mq-processor.decorator";

/**
 * Mark a class as the worker for a queue. Accepts either a `QueueDef`
 * (preferred — see {@link defineQueue}) or a raw queue name string.
 *
 * When a `QueueDef` carries `workerOptions`, they are merged with the
 * `options` argument; per-call options win.
 */
export function Processor(target: QueueDef | string, options: WorkerOptions = {}): ClassDecorator {
  if (typeof target === "string") {
    return MqProcessor(target, options);
  }
  const merged: WorkerOptions = { ...target.workerOptions, ...options };
  const queueDef = target;
  // Store the full QueueDef reference (including compiledValidators) so the
  // registry can use it for consume-time validation without a separate lookup.
  return (targetClass: Function, context?: any) => {
    const value = { queueName: queueDef.name, options: merged, queueDef };
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_PROCESSOR_METADATA, value);
      return;
    }
    Reflect.defineMetadata(MQ_PROCESSOR_METADATA, value, targetClass);
  };
}
