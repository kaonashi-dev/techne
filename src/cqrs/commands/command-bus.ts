import { Injectable } from "../../decorators";
import type { Command, ICommandHandler } from "../types";

@Injectable()
export class CommandBus {
  private handlers = new Map<Function, ICommandHandler>();

  register(commandClass: Function, handler: ICommandHandler): void {
    this.handlers.set(commandClass, handler);
  }

  async execute<TCommand extends Command>(command: TCommand): Promise<void> {
    const handler = this.handlers.get(command.constructor as Function);
    if (!handler) {
      throw new Error(`No command handler registered for ${command.constructor.name}`);
    }
    await handler.execute(command);
  }
}
