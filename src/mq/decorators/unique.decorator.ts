import "../../reflect-setup";
import { MQ_UNIQUE_METADATA, MQ_UNIQUE_UNTIL_PROCESSING_METADATA } from "../../common/constants";
import { defineMetadataFromContext, isDecoratorContext } from "../../core/metadata-store";

export interface UniqueOptions {
  /** Time-to-live for the uniqueness lock in milliseconds. */
  for: number;
  /** Custom key function — receives the dispatch payload, returns the dedup string. Defaults to `JSON.stringify(payload)`. */
  key?: (payload: unknown) => string;
  /** When `true`, a second dispatch within the TTL throws `JobNotUniqueError` instead of being silently dropped. */
  throwIfLocked?: boolean;
}

/**
 * Enforce at-most-one-in-flight for a `Dispatchable` job.
 *
 * The uniqueness lock is acquired at dispatch time and released when the job
 * completes or permanently fails. A second `dispatch()` for the same effective
 * key within the TTL window is silently dropped (or throws if
 * `throwIfLocked: true`).
 *
 * @example
 *   \@Unique({ for: 60_000 })
 *   class SendWelcomeEmail extends Dispatchable<{ userId: string }> { ... }
 */
export function Unique(options: UniqueOptions): ClassDecorator {
  return (target: Function, context?: unknown) => {
    if (isDecoratorContext(context) && (context as { metadata?: object }).metadata) {
      defineMetadataFromContext(
        (context as { metadata: object }).metadata,
        MQ_UNIQUE_METADATA,
        options,
      );
      return;
    }
    Reflect.defineMetadata(MQ_UNIQUE_METADATA, options, target);
  };
}

/**
 * Like `@Unique`, but the lock is released as soon as the worker claims the
 * job (before `handle()` runs). This allows a fresh dispatch to be enqueued
 * while the previous execution is still in progress.
 *
 * @example
 *   \@UniqueUntilProcessing({ for: 30_000 })
 *   class SyncInventory extends Dispatchable<void> { ... }
 */
export function UniqueUntilProcessing(options: UniqueOptions): ClassDecorator {
  return (target: Function, context?: unknown) => {
    if (isDecoratorContext(context) && (context as { metadata?: object }).metadata) {
      defineMetadataFromContext(
        (context as { metadata: object }).metadata,
        MQ_UNIQUE_UNTIL_PROCESSING_METADATA,
        options,
      );
      return;
    }
    Reflect.defineMetadata(MQ_UNIQUE_UNTIL_PROCESSING_METADATA, options, target);
  };
}
