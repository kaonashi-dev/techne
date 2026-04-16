import { EventEmitter } from "node:events";
import { createMqDriver } from "./driver";
import type { QueueDriver, QueueEventName, QueueOptions } from "./types";

const KNOWN_EVENTS: QueueEventName[] = [
  "waiting",
  "active",
  "completed",
  "failed",
  "progress",
  "stalled",
  "drained",
];

export class QueueEvents extends EventEmitter {
  private readonly driver: QueueDriver;
  private unsubscribe?: () => Promise<void> | void;

  constructor(
    private readonly name: string,
    options: QueueOptions = {},
    driver?: QueueDriver,
  ) {
    super();
    this.driver = driver ?? createMqDriver(options.connection);
    void this.bind();
  }

  async close(): Promise<void> {
    await this.unsubscribe?.();
    this.removeAllListeners();
  }

  private async bind() {
    this.unsubscribe = await this.driver.subscribe(this.name, ({ event, payload }) => {
      if (KNOWN_EVENTS.includes(event)) {
        this.emit(event, payload);
      }
    });
  }
}
