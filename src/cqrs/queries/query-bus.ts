import { Injectable } from "../../decorators";
import type { IQueryHandler, Query } from "../types";

@Injectable()
export class QueryBus {
  private handlers = new Map<Function, IQueryHandler>();

  register(queryClass: Function, handler: IQueryHandler): void {
    this.handlers.set(queryClass, handler);
  }

  async execute<TQuery extends Query, TResult = any>(query: TQuery): Promise<TResult> {
    const handler = this.handlers.get(query.constructor as Function);
    if (!handler) {
      throw new Error(`No query handler registered for ${query.constructor.name}`);
    }
    return await handler.execute(query);
  }
}
