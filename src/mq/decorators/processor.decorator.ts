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
  return MqProcessor(target.name, merged);
}
