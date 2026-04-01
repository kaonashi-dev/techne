import { Injectable } from "../../decorators";
import type { DomainEvent, IEventHandler } from "../types";
import { InMemoryEventStore } from "./event-store";

@Injectable()
export class EventBus {
  private handlers = new Map<Function, IEventHandler[]>();

  constructor(private readonly eventStore: InMemoryEventStore) {}

  register(eventClass: Function, handler: IEventHandler): void {
    const handlers = this.handlers.get(eventClass) || [];
    handlers.push(handler);
    this.handlers.set(eventClass, handlers);
  }

  async emit(event: DomainEvent, aggregateId: string = "global"): Promise<void> {
    await this.eventStore.append(aggregateId, event.constructor.name, event.data);
    const handlers = this.handlers.get(event.constructor as Function) || [];
    await Promise.allSettled(handlers.map((handler) => handler.handle(event)));
  }
}
