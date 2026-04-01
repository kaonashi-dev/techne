import { EVENT_PATTERN_METADATA, MESSAGE_PATTERN_METADATA } from "../common/constants";
import type { Container } from "../core/container";
import { LocalClient } from "./transports/local/local-client";
import { LocalServer } from "./transports/local/local-server";
import { RedisClient } from "./transports/redis/redis-client";
import { RedisServer } from "./transports/redis/redis-server";
import type { MicroserviceOptions } from "./types";

export class MicroservicesAdapter {
  constructor(private readonly container: Container) {}

  create(classes: any[], options: MicroserviceOptions) {
    const server =
      options.transport === "redis" ? new RedisServer(options.options) : new LocalServer();
    const client =
      options.transport === "redis"
        ? new RedisClient(options.options)
        : new LocalClient(server as LocalServer);

    for (const target of classes) {
      const instance = this.container.get<any>(target);
      const messagePatterns: Record<string, string> =
        Reflect.getMetadata(MESSAGE_PATTERN_METADATA, target) || {};
      const eventPatterns: Record<string, string> =
        Reflect.getMetadata(EVENT_PATTERN_METADATA, target) || {};

      for (const [methodName, pattern] of Object.entries(messagePatterns)) {
        server.registerHandler(pattern, (data) => instance[methodName](data));
      }

      for (const [methodName, pattern] of Object.entries(eventPatterns)) {
        server.registerEventHandler(pattern, (data) => instance[methodName](data));
      }
    }

    return { server, client, container: this.container };
  }
}
