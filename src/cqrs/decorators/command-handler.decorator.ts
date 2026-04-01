import "reflect-metadata";
import { COMMAND_HANDLER_METADATA } from "../../common/constants";

export function CommandHandler(command: any): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(COMMAND_HANDLER_METADATA, command, target);
  };
}
