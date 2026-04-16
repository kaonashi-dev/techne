import { MemoryQueueDriver } from "./drivers/memory";
import { RedisQueueDriver } from "./drivers/redis";
import type { MqConnectionOptions, QueueDriver } from "./types";

export function createMqDriver(connection: MqConnectionOptions = {}): QueueDriver {
  if (connection.driver === "redis") {
    return new RedisQueueDriver(connection);
  }
  return new MemoryQueueDriver();
}
