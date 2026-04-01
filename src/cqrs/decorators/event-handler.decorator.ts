import "reflect-metadata";
import { EVENT_HANDLER_METADATA } from "../../common/constants";

export function EventHandler(event: any): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(EVENT_HANDLER_METADATA, event, target);
  };
}
