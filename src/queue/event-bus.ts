import { EventEmitter } from "node:events";

const eventBuses = new Map<string, EventEmitter>();

export function getQueueEventBus(queueName: string): EventEmitter {
  let bus = eventBuses.get(queueName);
  if (!bus) {
    bus = new EventEmitter();
    eventBuses.set(queueName, bus);
  }
  return bus;
}
