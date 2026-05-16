import { MqProcessor } from "./mq-processor.decorator";
import type { WorkerOptions } from "../types";

/**
 * Primary processor decorator. Marks a class as a queue worker for the named
 * queue. Alias for `@MqProcessor`; a `handle()` method on the decorated class
 * is auto-registered as the default handler — no `@MqProcess()` required for
 * the common single-job-type case.
 */
export function Queue(queueName: string, options: WorkerOptions = {}): ClassDecorator {
  return MqProcessor(queueName, options);
}
