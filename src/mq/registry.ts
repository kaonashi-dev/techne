import { MQ_PROCESSOR_METADATA, MQ_PROCESS_METADATA } from "../common/constants";
import type { Container } from "../core/container";
import { isCustomProvider } from "../core/container";
import { Queue } from "./queue";
import { getMqToken } from "./tokens";
import type { MqProcessorMetadata, ProcessMetadata, QueueDriver } from "./types";
import { Worker } from "./worker";

export class MqRegistry {
  private workers: Worker[] = [];

  constructor(
    private readonly container: Container,
    private readonly driver: QueueDriver,
  ) {}

  register(containerToken?: boolean): void {
    if (containerToken === false) return;
    this.container.set(MqRegistry, this);
  }

  registerFromClasses(classes: any[]): void {
    for (const provider of classes) {
      if (isCustomProvider(provider)) continue;
      const processor = Reflect.getMetadata(MQ_PROCESSOR_METADATA, provider) as
        | MqProcessorMetadata
        | undefined;
      if (!processor) continue;
      if (!this.container.isStatic(provider)) continue;

      const processMetadata = (Reflect.getMetadata(MQ_PROCESS_METADATA, provider) ||
        {}) as ProcessMetadata;
      const instance = this.container.get<any>(provider);
      const queue = this.container.get<Queue>(getMqToken(processor.queueName));

      const worker = new Worker(
        queue,
        async (job) => {
          const handlerName =
            this.findHandler(processMetadata, job.name) ?? this.findHandler(processMetadata);
          if (!handlerName || typeof instance[handlerName] !== "function") {
            throw new Error(
              `No processor handler found for job '${job.name}' in queue '${processor.queueName}'`,
            );
          }
          return await instance[handlerName](job);
        },
        {
          ...processor.options,
          autorun: false,
        },
      );

      this.workers.push(worker);
      void worker.run();
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await this.driver.close();
  }

  private findHandler(processMetadata: ProcessMetadata, jobName?: string): string | undefined {
    for (const [methodName, registeredJobName] of Object.entries(processMetadata)) {
      if (registeredJobName === jobName) return methodName;
    }
    if (jobName !== undefined) return undefined;
    return Object.entries(processMetadata).find(
      ([, registeredJobName]) => registeredJobName === undefined,
    )?.[0];
  }
}
