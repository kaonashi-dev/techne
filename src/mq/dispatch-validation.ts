import type { TSchema } from "@sinclair/typebox";
import type { TypeCheck } from "@sinclair/typebox/compiler";
import { QueuePayloadValidationError } from "./errors";

/**
 * Registry of compiled dispatch-time validators keyed by queue name.
 *
 * Lives in its own leaf module (instead of `define-queue.ts`) so `Queue` can
 * import it without creating a runtime cycle through `pending-dispatch` /
 * `dispatcher`. `Queue.add`/`addBulk` consult it so the low-level dispatch
 * path enforces the same schemas as the typed `QueueDef` dispatchers.
 */
const dispatchValidators = new Map<string, ReadonlyMap<string, TypeCheck<TSchema>>>();

/**
 * @internal Called by `finalizeQueueDef`. Always sets or clears the entry so
 * a queue re-defined without validation doesn't keep stale validators.
 */
export function setDispatchValidators(
  queueName: string,
  validators: ReadonlyMap<string, TypeCheck<TSchema>> | undefined,
): void {
  if (validators) {
    dispatchValidators.set(queueName, validators);
  } else {
    dispatchValidators.delete(queueName);
  }
}

/**
 * Validates a payload against the queue's registered dispatch schema.
 * Throws {@link QueuePayloadValidationError} on failure; no-op when the
 * queue (or job) has no dispatch-time validator — queues that never opted
 * in pay a single Map miss.
 */
export function validateDispatchPayload(
  queueName: string,
  jobName: string,
  payload: unknown,
): void {
  const validators = dispatchValidators.get(queueName);
  if (!validators) return;
  const validator = validators.get(jobName);
  if (!validator || validator.Check(payload)) return;
  const errors = [...validator.Errors(payload)].map((e) => ({
    path: e.path,
    message: e.message,
  }));
  throw new QueuePayloadValidationError(jobName, queueName, errors);
}
