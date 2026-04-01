import { describe, expect, test } from "bun:test";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";
import { NestiaFactory } from "../src/factory/nestia-factory";
import {
  BusRegistry,
  Command,
  CommandBus,
  CommandHandler,
  CqrsQuery,
  DomainEvent,
  EventBus,
  EventHandler,
  InMemoryEventStore,
  QueryBus,
  QueryHandler,
} from "../src";
import { Container } from "../src/core/container";

class CreateUserCommand extends Command<{ name: string }> {}
class ListUsersQuery extends CqrsQuery<void, string[]> {}
class UserCreatedEvent extends DomainEvent<{ name: string }> {}

@Injectable()
class UsersRepo {
  public readonly items: string[] = [];
}

@CommandHandler(CreateUserCommand)
@Injectable()
class CreateUserHandler {
  constructor(
    private readonly repo: UsersRepo,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateUserCommand) {
    this.repo.items.push(command.payload.name);
    await this.eventBus.emit(
      new UserCreatedEvent({ name: command.payload.name }),
      command.payload.name,
    );
  }
}

@QueryHandler(ListUsersQuery)
@Injectable()
class ListUsersHandler {
  constructor(private readonly repo: UsersRepo) {}

  execute() {
    return [...this.repo.items];
  }
}

@EventHandler(UserCreatedEvent)
@Injectable()
class AuditUserCreatedHandler {
  public events: string[] = [];

  handle(event: UserCreatedEvent) {
    this.events.push(event.data.name);
  }
}

describe("CQRS", () => {
  test("registers and executes command/query/event handlers", async () => {
    const container = new Container();
    const buses = new BusRegistry(container);
    buses.register();
    buses.registerFromClasses([
      UsersRepo,
      CreateUserHandler,
      ListUsersHandler,
      AuditUserCreatedHandler,
    ]);

    const commandBus = container.get<CommandBus>(CommandBus);
    const queryBus = container.get<QueryBus>(QueryBus);
    const eventStore = container.get<InMemoryEventStore>(InMemoryEventStore);
    const audit = container.get<AuditUserCreatedHandler>(AuditUserCreatedHandler);

    await commandBus.execute(new CreateUserCommand({ name: "Ada" }));
    const users = await queryBus.execute<ListUsersQuery, string[]>(new ListUsersQuery(undefined));

    expect(users).toEqual(["Ada"]);
    expect(audit.events).toEqual(["Ada"]);
    expect(await eventStore.getEvents("Ada")).toHaveLength(1);
  });

  test("wires CQRS buses through NestiaFactory", async () => {
    @Module({
      providers: [UsersRepo, CreateUserHandler, ListUsersHandler, AuditUserCreatedHandler],
    })
    class AppModule {}

    NestiaFactory.create(AppModule, { logger: false });
  });
});
