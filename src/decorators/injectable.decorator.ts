import "reflect-metadata";
import { INJECTABLE_METADATA } from "../common/constants";

export function Injectable(): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(INJECTABLE_METADATA, true, target);
  };
}
