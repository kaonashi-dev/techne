import { Command } from "../../../../src/cqrs/index.ts";

export class CreateUserCommand extends Command<{ name: string; email: string }> {}
