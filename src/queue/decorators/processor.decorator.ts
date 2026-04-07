import "../../reflect-setup";
import { QUEUE_PROCESSOR_METADATA } from "../../common/constants";
import type { WorkerOptions } from "../types";

export function Processor(queueName: string, options: WorkerOptions = {}): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(QUEUE_PROCESSOR_METADATA, { queueName, options }, target);
  };
}
