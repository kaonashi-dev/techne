export abstract class Command<T = any> {
  constructor(public readonly payload: T) {}
}

export abstract class Query<T = any, _R = any> {
  constructor(public readonly payload: T) {}
}

export abstract class DomainEvent<T = any> {
  public readonly timestamp: number;

  constructor(public readonly data: T) {
    this.timestamp = Date.now();
  }
}

export interface StoredEvent {
  id: string;
  aggregateId: string;
  type: string;
  data: any;
  timestamp: number;
}

export interface ICommandHandler<TCommand extends Command = Command> {
  execute(command: TCommand): Promise<void> | void;
}

export interface IQueryHandler<TQuery extends Query = Query, TResult = any> {
  execute(query: TQuery): Promise<TResult> | TResult;
}

export interface IEventHandler<TEvent extends DomainEvent = DomainEvent> {
  handle(event: TEvent): Promise<void> | void;
}
