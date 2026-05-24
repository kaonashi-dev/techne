import type { QueueDef } from "../define-queue";
import { MqProcess } from "./mq-process.decorator";

/**
 * Bind a method to a named job. Mirrors `@MqProcess(name)` but reads as
 * the consumer-side counterpart to `defineQueue`'s job map.
 *
 * For full type safety against the queue's job names, use the typed
 * factory: `const On = onFor(MyQueueDef)` then `@On("job-name")`.
 */
export function On(name: string): MethodDecorator {
  return MqProcess(name);
}

/**
 * Build a typed `@On(...)` decorator that only accepts job names declared
 * on the given `QueueDef`. Useful when the consumer file already imports
 * the def — gets you a typo-proof handler binding.
 */
export function onFor<Def extends QueueDef>(
  _def: Def,
): <K extends keyof Def["jobs"] & string>(name: K) => MethodDecorator {
  return (name) => MqProcess(name);
}
