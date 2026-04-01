import type { MessageHandler } from "./types";

export abstract class BnestMicroservice {
  protected handlers = new Map<string, MessageHandler>();
  protected eventHandlers = new Map<string, MessageHandler[]>();

  registerHandler(pattern: string, handler: MessageHandler): void {
    this.handlers.set(pattern, handler);
  }

  registerEventHandler(pattern: string, handler: MessageHandler): void {
    const handlers = this.eventHandlers.get(pattern) || [];
    handlers.push(handler);
    this.eventHandlers.set(pattern, handlers);
  }

  abstract listen(): Promise<void>;
  abstract close(): Promise<void>;
}
