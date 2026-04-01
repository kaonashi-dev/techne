import { BnestMicroservice } from "../../abstract-server";

export class LocalServer extends BnestMicroservice {
  async listen(): Promise<void> {}

  async close(): Promise<void> {
    this.handlers.clear();
    this.eventHandlers.clear();
  }

  async handle(pattern: string, data: any): Promise<any> {
    const handler = this.handlers.get(pattern);
    if (!handler) {
      throw new Error(`No message handler registered for ${pattern}`);
    }
    return await handler(data);
  }

  async dispatch(pattern: string, data: any): Promise<void> {
    const handlers = this.eventHandlers.get(pattern) || [];
    await Promise.allSettled(handlers.map((handler) => handler(data)));
  }
}
