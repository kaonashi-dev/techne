import { EventHandler } from "../../../../src/cqrs/index.ts";
import type { IEventHandler } from "../../../../src/cqrs/index.ts";
import { Injectable, InjectLogger, Logger } from "../../../../src/common/index.ts";
import { UserCreatedEvent } from "./user-created.event";

@EventHandler(UserCreatedEvent)
@Injectable()
export class UserCreatedLogger implements IEventHandler<UserCreatedEvent> {
  constructor(@InjectLogger("UserCreated") private readonly logger: Logger) {}

  handle(event: UserCreatedEvent): void {
    this.logger.log("user created (event)", { id: event.data.id, email: event.data.email });
  }
}
