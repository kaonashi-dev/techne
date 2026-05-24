import type { Job } from "./job";
import { PendingDispatch } from "./pending-dispatch";
import type { Queue } from "./queue";
import type { JobsOptions, WorkerOptions } from "./types";

export type JobMap = Record<string, unknown>;

export interface QueueDefInput<N extends string, T extends JobMap> {
  name: N;
  jobs: T;
}

/**
 * Per-job fluent dispatcher attached to a `QueueDef.dispatchers` map.
 * Each call returns a `PendingDispatch` builder — awaiting enqueues.
 */
export type DispatcherFn<TPayload> = (
  ...args: TPayload extends void | Record<string, never> ? [] : [payload: TPayload]
) => PendingDispatch<TPayload>;

export type DispatchersOf<T extends JobMap> = {
  readonly [K in keyof T & string]: DispatcherFn<T[K]>;
};

export interface QueueDef<N extends string = string, T extends JobMap = JobMap> {
  readonly name: N;
  readonly jobs: T;
  /** Default worker options applied when this def is used with `@Processor(def)`. */
  readonly workerOptions?: WorkerOptions;
  /**
   * Per-job fluent dispatchers, keyed by job name. Each is a function
   * returning a `PendingDispatch` builder. Awaiting enqueues via the
   * dispatcher context registered by `mq()`.
   *
   * @example
   *   const { initiatePayin } = PayinsQueueDef.dispatchers;
   *   await initiatePayin({ payinId }).delay(60_000).tries(3);
   */
  readonly dispatchers: DispatchersOf<T>;
}

/**
 * Typed view over `Queue` that constrains `add(name, data)` to the
 * job names + payloads declared in a `QueueDef`.
 *
 * It is a structural type — the underlying runtime value injected by
 * `@InjectQueue(def)` is still a regular `Queue` instance, so all other
 * methods (`addBulk`, `pause`, `getJob`, …) remain available.
 */
export type QueueOf<Def extends QueueDef> = Omit<Queue, "add"> & {
  add<K extends keyof Def["jobs"] & string>(
    name: K,
    data: Def["jobs"][K],
    opts?: JobsOptions,
  ): ReturnType<Queue["add"]>;
};

export type JobOf<Def extends QueueDef, K extends keyof Def["jobs"]> = Job<Def["jobs"][K]>;

/**
 * Map a tuple of `QueueDef`s to a record keyed by each def's `name`, with
 * values typed as `QueueOf<Def>`. Used as the parameter type for
 * `@InjectQueue([A, B, …])`.
 *
 * @example
 *   constructor(
 *     @InjectQueue([PayinsQueue, AlertsQueue])
 *     queues: QueueBagOf<[typeof PayinsQueue, typeof AlertsQueue]>,
 *   ) {
 *     queues.payins.add("initiate-payin", { payinId });
 *     queues.alerts.add("warn", { msg });
 *   }
 */
export type QueueBagOf<Defs extends readonly QueueDef[]> = {
  readonly [Def in Defs[number] as Def["name"]]: QueueOf<Def>;
};

export interface DefineQueueOptions {
  /**
   * Worker options used as the default for `@Processor(def)`. Per-processor
   * overrides passed to `@Processor(def, opts)` win.
   */
  worker?: WorkerOptions;
}

export interface DefineQueueFromClassOptions<N extends string = string> extends DefineQueueOptions {
  /** Override the queue name. Defaults to the class's runtime name. */
  name?: N;
}

type MethodNameOf<I> = {
  [K in keyof I]: I[K] extends (...args: never[]) => unknown ? K : never;
}[keyof I] &
  string;

/**
 * Map a class's instance methods into a `JobMap`:
 * - the method name becomes the job name
 * - the method's first parameter type becomes the payload
 * - methods with no parameters get `Record<string, never>` as payload
 */
export type ClassToJobMap<I> = {
  [K in MethodNameOf<I>]: I[K] extends (arg: infer P, ...rest: never[]) => unknown
    ? unknown extends P
      ? Record<string, never>
      : P
    : Record<string, never>;
};

export type QueueDefFromClass<
  C extends abstract new (...args: never[]) => unknown,
  N extends string = string,
> = QueueDef<N, ClassToJobMap<InstanceType<C>>>;

/**
 * Declare a queue contract — its name and the shape of each job payload —
 * in one place. Both producers (`@InjectQueue(def)`) and consumers
 * (`@Processor(def)` + `@On("job-name")`) reference the same definition,
 * so renaming a job name surfaces as a TypeScript error on every callsite.
 *
 * @example
 *   export const PayinsQueue = defineQueue({
 *     name: "payins",
 *     jobs: {
 *       "initiate-payin": {} as { payinId: string },
 *       "settle-payins":  {} as Record<string, never>,
 *     },
 *   });
 */
export function defineQueue<N extends string, T extends JobMap>(
  input: QueueDefInput<N, T>,
  options?: DefineQueueOptions,
): QueueDef<N, T>;
export function defineQueue<
  C extends abstract new (...args: never[]) => unknown,
  N extends string = string,
>(cls: C, options?: DefineQueueFromClassOptions<N>): QueueDefFromClass<C, N>;
export function defineQueue(
  input: QueueDefInput<string, JobMap> | (abstract new (...args: never[]) => unknown),
  options: DefineQueueOptions & { name?: string } = {},
): QueueDef {
  if (typeof input === "function") {
    const cls = input as abstract new (...args: never[]) => unknown;
    const name = options.name ?? cls.name;
    if (!name) {
      throw new TypeError(
        "defineQueue(class): class has no runtime name — pass { name: '…' } explicitly",
      );
    }
    const proto = (cls as { prototype: Record<string, unknown> }).prototype;
    const jobs: Record<string, undefined> = {};
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === "constructor") continue;
      if (typeof proto[key] !== "function") continue;
      jobs[key] = undefined;
    }
    return finalizeQueueDef(name, jobs, options.worker);
  }
  return finalizeQueueDef(input.name, input.jobs, options.worker);
}

function finalizeQueueDef(name: string, jobs: JobMap, workerOptions?: WorkerOptions): QueueDef {
  const dispatchers: Record<string, DispatcherFn<unknown>> = {};
  for (const jobName of Object.keys(jobs)) {
    dispatchers[jobName] = ((payload?: unknown) =>
      new PendingDispatch({
        queueName: name,
        jobName,
        payload: payload as unknown,
      })) as DispatcherFn<unknown>;
  }
  return Object.freeze({
    name,
    jobs: Object.freeze({ ...jobs }) as JobMap,
    workerOptions,
    dispatchers: Object.freeze(dispatchers) as DispatchersOf<JobMap>,
  }) as QueueDef;
}

export function isQueueDef(value: unknown): value is QueueDef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as QueueDef).name === "string" &&
    typeof (value as QueueDef).jobs === "object" &&
    (value as QueueDef).jobs !== null &&
    !(QUEUE_BAG_TOKEN in (value as object))
  );
}

/** Internal symbol carried by every `QueueBagDef` so the DI layer can look it up. */
export const QUEUE_BAG_TOKEN = Symbol("QueueBagToken");

export interface QueueBagDef<M extends Record<string, QueueDef> = Record<string, QueueDef>> {
  /** Synthetic DI token unique to this bag. Used by `@InjectQueue(bag)`. */
  readonly [QUEUE_BAG_TOKEN]: symbol;
  /** The keyed mapping the user declared. */
  readonly queues: M;
  /** All underlying queue defs, deduped, in declaration order. */
  readonly defs: readonly QueueDef[];
}

/**
 * Type-derived view of a `QueueBagDef`. Each user-chosen key maps to a
 * `QueueOf<Def>` so producers get full type safety on `add(name, data)`.
 *
 * @example
 *   const PayinsBag = defineQueueBag({ payins: PayinsQueueDef, alerts: AlertsQueueDef });
 *   constructor(@InjectQueue(PayinsBag) private q: BagOf<typeof PayinsBag>) {}
 *   await this.q.payins.add("initiate-payin", { payinId });
 */
export type BagOf<Bag extends QueueBagDef> = {
  readonly [K in keyof Bag["queues"]]: QueueOf<Bag["queues"][K]>;
};

/**
 * Group several `QueueDef`s under user-chosen keys. The returned bag is
 * the single source of truth for both the DI binding and the parameter
 * type — `@InjectQueue(bag)` + `BagOf<typeof bag>` — so neither the def
 * list nor the keys are repeated.
 *
 * Pass the bag to `mq({ queues: [bag] })` and its constituent queues are
 * registered automatically. Bags may be mixed with bare defs in `queues`.
 */
export function defineQueueBag<const M extends Record<string, QueueDef>>(map: M): QueueBagDef<M> {
  const defs: QueueDef[] = [];
  const seen = new Set<string>();
  for (const def of Object.values(map)) {
    if (seen.has(def.name)) continue;
    seen.add(def.name);
    defs.push(def);
  }
  const keys = Object.keys(map).join(",");
  return Object.freeze({
    [QUEUE_BAG_TOKEN]: Symbol(`QueueBag(${keys})`),
    queues: Object.freeze({ ...map }) as M,
    defs: Object.freeze(defs),
  });
}

export function isQueueBagDef(value: unknown): value is QueueBagDef {
  return (
    typeof value === "object" &&
    value !== null &&
    QUEUE_BAG_TOKEN in (value as object) &&
    typeof (value as QueueBagDef)[QUEUE_BAG_TOKEN] === "symbol"
  );
}
