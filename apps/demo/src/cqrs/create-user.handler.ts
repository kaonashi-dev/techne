import { Injectable } from "../../../../src/common/index.ts";
import { ModuleRef } from "../../../../src/core/index.ts";
import { CommandHandler, EventBus } from "../../../../src/cqrs/index.ts";
import type { ICommandHandler } from "../../../../src/cqrs/index.ts";
import { CreateUserCommand } from "./create-user.command";
import { CqrsStore } from "./cqrs-store.service";
import { UserCreatedEvent } from "./user-created.event";

/**
 * Writes to the read-model and emits a domain event. The `EventBus` is resolved
 * lazily via `ModuleRef` so the emitted event reaches handlers registered after
 * this provider was constructed.
 */
@CommandHandler(CreateUserCommand)
@Injectable()
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly store: CqrsStore,
    private readonly moduleRef: ModuleRef,
  ) {}

  async execute(command: CreateUserCommand): Promise<void> {
    const user = this.store.add(command.payload.name, command.payload.email);
    const eventBus = this.moduleRef.get<EventBus>(EventBus);
    await eventBus.emit(new UserCreatedEvent(user), `user-${user.id}`);
  }
}
