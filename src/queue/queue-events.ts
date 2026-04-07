import { EventEmitter } from "node:events";
import { createQueueDriver } from "./driver";
import type { QueueDriver, QueueOptions } from "./types";

export class QueueEvents extends EventEmitter {
  private readonly driver: QueueDriver;
  private readonly bus: EventEmitter;

  constructor(
    private readonly name: string,
    options: QueueOptions = {},
    driver?: QueueDriver,
  ) {
    super();
    this.driver = driver ?? createQueueDriver(options.connection);
    this.bus = this.driver.getEventBus(name);
    for (const event of ["waiting", "active", "completed", "failed", "progress", "stalled"]) {
      this.bus.on(event, (payload) => this.emit(event, payload));
    }
  }

  async close(): Promise<void> {
    this.removeAllListeners();
  }
}
