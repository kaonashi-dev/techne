import {
  COMMAND_HANDLER_METADATA,
  EVENT_HANDLER_METADATA,
  QUERY_HANDLER_METADATA,
} from "../common/constants";
import { type Container, isCustomProvider } from "../core/container";
import { CommandBus } from "./commands/command-bus";
import { EventBus } from "./events/event-bus";
import { InMemoryEventStore } from "./events/event-store";
import { QueryBus } from "./queries/query-bus";

export class BusRegistry {
  public readonly commandBus: CommandBus;
  public readonly queryBus: QueryBus;
  public readonly eventBus: EventBus;
  public readonly eventStore: InMemoryEventStore;

  constructor(private readonly container: Container) {
    this.eventStore = new InMemoryEventStore();
    this.eventBus = new EventBus(this.eventStore);
    this.commandBus = new CommandBus();
    this.queryBus = new QueryBus();
  }

  register(containerToken?: boolean): void {
    if (containerToken === false) return;
    this.container.set(CommandBus, this.commandBus);
    this.container.set(QueryBus, this.queryBus);
    this.container.set(EventBus, this.eventBus);
    this.container.set(InMemoryEventStore, this.eventStore);
  }

  registerFromClasses(classes: any[]): void {
    for (const provider of classes) {
      // Skip custom providers (objects like {provide, useClass}) — they don't have handler metadata
      if (isCustomProvider(provider)) continue;

      const instance = this.container.get<any>(provider);

      const command = Reflect.getMetadata(COMMAND_HANDLER_METADATA, provider) as
        | Function
        | undefined;
      if (command) {
        this.commandBus.register(command, instance);
      }

      const query = Reflect.getMetadata(QUERY_HANDLER_METADATA, provider) as Function | undefined;
      if (query) {
        this.queryBus.register(query, instance);
      }

      const event = Reflect.getMetadata(EVENT_HANDLER_METADATA, provider) as Function | undefined;
      if (event) {
        this.eventBus.register(event, instance);
      }
    }
  }
}
