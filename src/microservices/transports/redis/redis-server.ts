import { BnestMicroservice } from "../../abstract-server";
import type { MessagePayload, MicroserviceResponse } from "../../types";

export class RedisServer extends BnestMicroservice {
  private pub: any;
  private sub: any;
  private readonly prefix: string;
  private readonly timeout: number;

  constructor(private readonly options: Record<string, any> = {}) {
    super();
    this.prefix = options.prefix || "bnest";
    this.timeout = options.timeout || 5000;
    this.pub = options.publisher || this.createClient();
    this.sub = options.subscriber || this.createClient();
  }

  private createClient(): any {
    if (this.options.clientFactory) {
      return this.options.clientFactory();
    }
    return (Bun as any).redis(this.options.url || "redis://127.0.0.1:6379");
  }

  async listen(): Promise<void> {
    const patterns = [...this.handlers.keys(), ...this.eventHandlers.keys()];
    for (const pattern of patterns) {
      await this.sub.subscribe(this.channel(pattern), (message: string) => {
        void this.handleIncoming(pattern, message);
      });
    }
  }

  async close(): Promise<void> {
    await this.sub?.quit?.();
    await this.pub?.quit?.();
  }

  private channel(pattern: string): string {
    return `${this.prefix}:${pattern}`;
  }

  private responseChannel(id: string): string {
    return `${this.prefix}:response:${id}`;
  }

  private async handleIncoming(pattern: string, rawMessage: string): Promise<void> {
    const payload = JSON.parse(rawMessage) as MessagePayload;

    if (this.handlers.has(pattern)) {
      const handler = this.handlers.get(pattern)!;
      try {
        const data = await handler(payload.data);
        const response: MicroserviceResponse = { id: payload.id, data };
        await this.pub.publish(this.responseChannel(payload.id), JSON.stringify(response));
      } catch (error) {
        const response: MicroserviceResponse = {
          id: payload.id,
          error: { status: 500, message: error instanceof Error ? error.message : String(error) },
        };
        await this.pub.publish(this.responseChannel(payload.id), JSON.stringify(response));
      }
      return;
    }

    const handlers = this.eventHandlers.get(pattern) || [];
    await Promise.allSettled(handlers.map((handler) => handler(payload.data)));
  }
}
