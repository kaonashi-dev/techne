import { Module } from "../../decorators/module.decorator";
import { createQueueDriver } from "../driver";
import { Queue } from "../queue";
import { QUEUE_DRIVER, QUEUE_MODULE_OPTIONS, getQueueToken } from "../tokens";
import type { QueueModuleOptions, RegisterQueueOptions } from "../types";

function createDynamicModule(metadata: {
  imports?: any[];
  providers?: any[];
  exports?: any[];
}): any {
  class DynamicQueueModule {}
  Module(metadata)(DynamicQueueModule);
  return DynamicQueueModule;
}

export class QueueModule {
  static register(options: QueueModuleOptions = {}): any {
    return createDynamicModule({
      providers: [
        { provide: QUEUE_MODULE_OPTIONS, useValue: options },
        {
          provide: QUEUE_DRIVER,
          useFactory: () => createQueueDriver(options.connection),
        },
      ],
      exports: [QUEUE_MODULE_OPTIONS, QUEUE_DRIVER],
    });
  }

  static registerQueue(...queues: RegisterQueueOptions[]): any {
    const providers = queues.map((queue) => ({
      provide: getQueueToken(queue.name),
      useFactory: (driver: any, moduleOptions?: QueueModuleOptions) =>
        new Queue(queue.name, { ...moduleOptions, ...queue }, driver),
      inject: [QUEUE_DRIVER, QUEUE_MODULE_OPTIONS],
    }));

    return createDynamicModule({
      providers,
      exports: providers.map((provider) => provider.provide),
    });
  }
}
