import { Inject } from "../../decorators/inject.decorator";
import {
  isQueueBagDef,
  isQueueDef,
  QUEUE_BAG_TOKEN,
  type QueueBagDef,
  type QueueDef,
} from "../define-queue";
import { MQ_QUEUE_BAG } from "../tokens";
import { InjectMq } from "./inject-mq.decorator";

/**
 * Inject one or many typed queues.
 *
 * - `@InjectQueue(def)` — injects the single `Queue` for `def.name`.
 *   Pair with `QueueOf<typeof def>` as the parameter type.
 * - `@InjectQueue(name)` — same, but referenced by raw queue name.
 * - `@InjectQueue(bag)` — injects a user-keyed bag produced by
 *   `defineQueueBag({...})`. Pair with `BagOf<typeof bag>` — neither the
 *   def list nor the keys need to be repeated at the parameter type.
 * - `@InjectQueue([defA, defB, …])` — name-keyed bag of just the listed
 *   queues. Pair with `QueueBagOf<[typeof defA, typeof defB, …]>`.
 */
export function InjectQueue(def: QueueDef): ParameterDecorator;
export function InjectQueue(bag: QueueBagDef): ParameterDecorator;
export function InjectQueue(name: string): ParameterDecorator;
export function InjectQueue(defs: readonly QueueDef[]): ParameterDecorator;
export function InjectQueue(
  target: QueueDef | QueueBagDef | readonly QueueDef[] | string,
): ParameterDecorator {
  if (Array.isArray(target)) {
    return Inject(MQ_QUEUE_BAG);
  }
  if (typeof target === "string") {
    if (!target) {
      throw new TypeError("InjectQueue requires a QueueDef or a non-empty queue name");
    }
    return InjectMq(target);
  }
  if (isQueueBagDef(target)) {
    return Inject(target[QUEUE_BAG_TOKEN]);
  }
  if (isQueueDef(target)) {
    return InjectMq(target.name);
  }
  throw new TypeError(
    "InjectQueue requires a QueueDef, QueueBagDef, a list of QueueDef, or a queue name",
  );
}
