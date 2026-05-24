import "../../reflect-setup";
import { MQ_DEFAULT_BACKOFF } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";
import type { BackoffOptions } from "../types";

/** Set the default retry backoff strategy for a `Dispatchable` subclass. */
export function Backoff(backoff: number | number[] | BackoffOptions): ClassDecorator {
  return (target: Function, context?: any) => {
    if (isDecoratorContext(context) && context.metadata) {
      defineMetadataFromContext(context.metadata, MQ_DEFAULT_BACKOFF, backoff);
      return;
    }
    Reflect.defineMetadata(MQ_DEFAULT_BACKOFF, backoff, target);
  };
}
