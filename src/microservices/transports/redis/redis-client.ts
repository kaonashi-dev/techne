import { ClientProxy } from "../../abstract-client";
import type { MessagePayload, MicroserviceResponse } from "../../types";

export class RedisClient extends ClientProxy {
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

  private channel(pattern: string): string {
    return `${this.prefix}:${pattern}`;
  }

  private responseChannel(id: string): string {
    return `${this.prefix}:response:${id}`;
  }

  async connect(): Promise<void> {}

  async close(): Promise<void> {
    await this.sub?.quit?.();
    await this.pub?.quit?.();
  }

  async send<T = any>(pattern: string, data: any): Promise<T> {
    const id = crypto.randomUUID();
    const payload: MessagePayload = { pattern, data, id, timestamp: Date.now() };

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Microservice timeout for ${pattern}`)),
        this.timeout,
      );
      void this.sub.subscribe(this.responseChannel(id), async (message: string) => {
        clearTimeout(timer);
        const response = JSON.parse(message) as MicroserviceResponse<T>;
        await this.sub.unsubscribe?.(this.responseChannel(id));
        if (response.error) {
          reject(new Error(response.error.message));
          return;
        }
        resolve(response.data as T);
      });
      void this.pub.publish(this.channel(pattern), JSON.stringify(payload));
    });
  }

  async emit(pattern: string, data: any): Promise<void> {
    const payload: MessagePayload = {
      pattern,
      data,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    await this.pub.publish(this.channel(pattern), JSON.stringify(payload));
  }
}
