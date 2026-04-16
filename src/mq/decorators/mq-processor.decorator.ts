import "../../reflect-setup";
import { MQ_PROCESSOR_METADATA } from "../../common/constants";
import type { WorkerOptions } from "../types";

export function MqProcessor(queueName: string, options: WorkerOptions = {}): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(MQ_PROCESSOR_METADATA, { queueName, options }, target);
  };
}
