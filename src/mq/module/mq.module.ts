import { Module } from "../../decorators/module.decorator";
import { createMqDriver } from "../driver";
import { Queue } from "../queue";
import { getMqToken, MQ_DRIVER, MQ_MODULE_OPTIONS } from "../tokens";
import type { MqModuleOptions, RegisterQueueOptions } from "../types";

function createDynamicModule(metadata: {
  global?: boolean;
  imports?: any[];
  providers?: any[];
  exports?: any[];
}): any {
  class DynamicMqModule {}
  Module(metadata)(DynamicMqModule);
  return DynamicMqModule;
}

export class MqModule {
  static register(options: MqModuleOptions = {}): any {
    return createDynamicModule({
      global: true,
      providers: [
        { provide: MQ_MODULE_OPTIONS, useValue: options },
        {
          provide: MQ_DRIVER,
          useFactory: () => createMqDriver(options.connection),
        },
      ],
      exports: [MQ_MODULE_OPTIONS, MQ_DRIVER],
    });
  }

  static registerQueue(...queues: RegisterQueueOptions[]): any {
    const providers = queues.map((queue) => ({
      provide: getMqToken(queue.name),
      useFactory: (driver: any, moduleOptions?: MqModuleOptions) =>
        new Queue(queue.name, { ...moduleOptions, ...queue }, driver),
      inject: [MQ_DRIVER, MQ_MODULE_OPTIONS],
    }));

    return createDynamicModule({
      providers,
      exports: providers.map((provider) => provider.provide),
    });
  }
}
