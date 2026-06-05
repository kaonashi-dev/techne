import "../../reflect-setup";
import { CONSOLE_COMMAND_METADATA } from "../../common/constants";
import {
  defineMetadataFromContext,
  getMetadataFromContext,
  isDecoratorContext,
} from "../../core/metadata-store";
import type { ConsoleCommandMeta } from "../types";

export interface ConsoleCommandOptions {
  description?: string;
  aliases?: string[];
  hidden?: boolean;
  middleware?: any[];
}

export function ConsoleCommand(name?: string, opts: ConsoleCommandOptions = {}): MethodDecorator {
  return (target: object, propertyKey: any, _descriptor?: PropertyDescriptor) => {
    const apply = (existing: Record<string, ConsoleCommandMeta>, methodName: string) => {
      existing[methodName] = { name: name ?? methodName, ...opts };
      return existing;
    };

    if (isDecoratorContext(propertyKey) && propertyKey.metadata) {
      const map =
        getMetadataFromContext<Record<string, ConsoleCommandMeta>>(
          propertyKey.metadata,
          CONSOLE_COMMAND_METADATA,
        ) ?? {};
      defineMetadataFromContext(
        propertyKey.metadata,
        CONSOLE_COMMAND_METADATA,
        apply(map, String(propertyKey.name)),
      );
      return;
    }
    const map = Reflect.getMetadata(CONSOLE_COMMAND_METADATA, target.constructor) ?? {};
    Reflect.defineMetadata(
      CONSOLE_COMMAND_METADATA,
      apply(map, String(propertyKey)),
      target.constructor,
    );
  };
}
