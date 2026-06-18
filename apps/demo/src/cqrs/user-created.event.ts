import { DomainEvent } from "../../../../src/cqrs/index.ts";

export class UserCreatedEvent extends DomainEvent<{ id: number; name: string; email: string }> {}
