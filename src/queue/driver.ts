import { MemoryQueueDriver } from "./drivers/memory";
import { RedisQueueDriver } from "./drivers/redis";
import type { QueueConnectionOptions, QueueDriver } from "./types";

export function createQueueDriver(connection: QueueConnectionOptions = {}): QueueDriver {
  if (connection.driver === "redis") {
    return new RedisQueueDriver(connection);
  }
  return new MemoryQueueDriver();
}
