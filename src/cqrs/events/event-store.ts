import type { StoredEvent } from "../types";

export class InMemoryEventStore {
  private events: StoredEvent[] = [];

  async append(aggregateId: string, type: string, data: any): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: crypto.randomUUID(),
      aggregateId,
      type,
      data,
      timestamp: Date.now(),
    };
    this.events.push(event);
    return event;
  }

  async getEvents(aggregateId: string): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.aggregateId === aggregateId);
  }

  async getEventsByType(type: string): Promise<StoredEvent[]> {
    return this.events.filter((event) => event.type === type);
  }

  async getAllEvents(): Promise<StoredEvent[]> {
    return [...this.events];
  }
}
