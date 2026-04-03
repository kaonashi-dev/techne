import type { StoredEvent } from "../types";

export class InMemoryEventStore {
  private events: StoredEvent[] = [];
  private byAggregate = new Map<string, StoredEvent[]>();
  private byType = new Map<string, StoredEvent[]>();

  async append(aggregateId: string, type: string, data: any): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: crypto.randomUUID(),
      aggregateId,
      type,
      data,
      timestamp: Date.now(),
    };

    this.events.push(event);

    const aggBucket = this.byAggregate.get(aggregateId);
    if (aggBucket) {
      aggBucket.push(event);
    } else {
      this.byAggregate.set(aggregateId, [event]);
    }

    const typeBucket = this.byType.get(type);
    if (typeBucket) {
      typeBucket.push(event);
    } else {
      this.byType.set(type, [event]);
    }

    return event;
  }

  async getEvents(aggregateId: string): Promise<StoredEvent[]> {
    return this.byAggregate.get(aggregateId) ?? [];
  }

  async getEventsByType(type: string): Promise<StoredEvent[]> {
    return this.byType.get(type) ?? [];
  }

  async getAllEvents(): Promise<StoredEvent[]> {
    return [...this.events];
  }
}
