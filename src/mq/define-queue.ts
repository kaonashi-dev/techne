import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler, type TypeCheck } from "@sinclair/typebox/compiler";
import type { Job } from "./job";
import { PendingDispatch } from "./pending-dispatch";
import type { Queue } from "./queue";
import type { BackoffOptions, JobsOptions, WorkerOptions } from "./types";
import { QueuePayloadValidationError } from "./errors";
import { setDispatchValidators } from "./dispatch-validation";
import { getOrCreateDtoSchema } from "../schema/dto";

export type JobMap = Record<string, unknown>;

/** Dispatch-time defaults for a single job. Per-call overrides always win. */
export interface DispatchDefaults {
  tries?: number;
  backoff?: number | number[] | BackoffOptions;
  timeout?: number;
  onQueue?: string;
}

/**
 * Schema value accepted in `QueueDefInput.schemas`: either a class decorated
 * with `@Dto()` (resolved via the DTO registry) or a raw TypeBox `TSchema`.
 */
export type JobSchema = (new (...args: any[]) => any) | TSchema;

export interface QueueDefInput<N extends string, T extends JobMap> {
  name: N;
  jobs: T;
  /** Per-job dispatch defaults. Keys must match declared job names. */
  defaults?: { [K in keyof T & string]?: DispatchDefaults };
  /**
   * Optional per-job validation schemas. Each value is either a `@Dto`-decorated
   * class or a raw TypeBox `TSchema`. Validators are compiled once at
   * `defineQueue` call time (boot).
   *
   * Only jobs listed here are validated; omitting a job name is valid and pays
   * zero overhead. Keys must be a subset of `jobs` keys — a boot-time check
   * throws `TypeError` if an unknown job name is referenced.
   *
   * NOTE: schemas describe the **post-JSON-roundtrip** wire shape; `Date`
   * fields arrive as strings and should be typed as `Type.String()`.
   */
  schemas?: { [K in keyof T & string]?: JobSchema };
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

/**
 * When and where payload validation is applied.
 * - `"dispatch"` — validate before enqueuing (synchronous throw on bad payload).
 * - `"consume"` — validate inside the worker before calling the handler.
 * - `"both"` — validate at both dispatch and consume time.
 */
export type QueueValidateMode = "dispatch" | "consume" | "both";

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
   *   const { initiateTask } = ExampleQueueDef.dispatchers;
   *   await initiateTask({ taskId }).delay(60_000).tries(3);
   */
  readonly dispatchers: DispatchersOf<T>;
  /**
   * TypeBox compiled validators, keyed by job name. Only present when the
   * queue was defined with a `schemas` entry for that job.
   * @internal
   */
  readonly compiledValidators?: ReadonlyMap<string, TypeCheck<TSchema>>;
  /**
   * Controls when validation runs. Absent means no validation (back-compat).
   * @internal
   */
  readonly validateMode?: QueueValidateMode;
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
 *     @InjectQueue([ExampleQueue, AlertsQueue])
 *     queues: QueueBagOf<[typeof ExampleQueue, typeof AlertsQueue]>,
 *   ) {
 *     queues.tasks.add("initiate-task", { taskId });
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
  /**
   * When to run payload validation. Requires `schemas` in the queue definition
   * input. Absent means no validation (zero overhead, full back-compat).
   *
   * - `"dispatch"` — validate before enqueuing; throws synchronously on failure.
   * - `"consume"` — validate inside the worker before calling the handler;
   *   failures flow into `@OnFailure` / `Dispatchable.failed()`.
   * - `"both"` — validate at both points.
   */
  validate?: QueueValidateMode;
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
 *   export const ExampleQueue = defineQueue({
 *     name: "tasks",
 *     jobs: {
 *       "initiate-task": {} as { taskId: string },
 *       "settle-tasks":  {} as Record<string, never>,
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
  return finalizeQueueDef(
    input.name,
    input.jobs,
    options.worker,
    input.defaults,
    input.schemas,
    options.validate,
  );
}

function compileJobSchema(
  queueName: string,
  jobName: string,
  schema: JobSchema,
): TypeCheck<TSchema> {
  // If it's a constructor (class), resolve through the DTO registry.
  if (typeof schema === "function") {
    const dtoSchema = getOrCreateDtoSchema(schema as new (...args: any[]) => any);
    if (dtoSchema) {
      return TypeCompiler.Compile(dtoSchema);
    }
    // A class without DTO metadata would silently validate nothing — make
    // the misconfiguration loud at boot, like the unknown-schema-key check.
    throw new TypeError(
      `defineQueue('${queueName}'): schema class '${schema.name || "(anonymous)"}' for job ` +
        `'${jobName}' has no DTO metadata. Decorate it with @Dto() / @Is* property ` +
        `decorators, or pass a raw TypeBox TSchema.`,
    );
  }
  // Raw TypeBox TSchema
  return TypeCompiler.Compile(schema as TSchema);
}

/**
 * Run compiled validators against a payload and throw `QueuePayloadValidationError`
 * if validation fails. No-op when no validator is registered for the job.
 */
export function validateQueuePayload(queueDef: QueueDef, jobName: string, payload: unknown): void {
  const validator = queueDef.compiledValidators?.get(jobName);
  if (!validator) return;
  if (validator.Check(payload)) return;
  const errors = [...validator.Errors(payload)].map((e) => ({
    path: e.path,
    message: e.message,
  }));
  throw new QueuePayloadValidationError(jobName, queueDef.name, errors);
}

function finalizeQueueDef(
  name: string,
  jobs: JobMap,
  workerOptions?: WorkerOptions,
  defaults?: Record<string, DispatchDefaults | undefined>,
  schemas?: Record<string, JobSchema | undefined>,
  validateMode?: QueueValidateMode,
): QueueDef {
  // Boot-time safety check: every schema key must also exist in jobs.
  if (schemas) {
    for (const schemaKey of Object.keys(schemas)) {
      if (!(schemaKey in jobs)) {
        throw new TypeError(
          `defineQueue('${name}'): schemas key '${schemaKey}' does not exist in jobs. ` +
            `Valid job names: ${Object.keys(jobs).join(", ") || "(none)"}`,
        );
      }
    }
  }

  // Compile validators once at boot time.
  let compiledValidators: Map<string, TypeCheck<TSchema>> | undefined;
  if (schemas) {
    compiledValidators = new Map();
    for (const [jobName, schema] of Object.entries(schemas)) {
      if (schema !== undefined) {
        compiledValidators.set(jobName, compileJobSchema(name, jobName, schema));
      }
    }
    if (compiledValidators.size === 0) compiledValidators = undefined;
  }

  // Determine whether dispatch-time validation is needed.
  const runDispatchValidation = validateMode === "dispatch" || validateMode === "both";

  // Register (or clear) the queue's dispatch validators so the low-level
  // `Queue.add`/`addBulk` path enforces the same schemas as the typed
  // dispatchers below.
  setDispatchValidators(
    name,
    runDispatchValidation && compiledValidators ? compiledValidators : undefined,
  );

  const dispatchers: Record<string, DispatcherFn<unknown>> = {};
  for (const jobName of Object.keys(jobs)) {
    const jobDefaults = defaults?.[jobName];
    dispatchers[jobName] = ((payload?: unknown) => {
      // Dispatch-time validation: run synchronously before building the builder.
      if (runDispatchValidation && compiledValidators) {
        const validator = compiledValidators.get(jobName);
        if (validator && !validator.Check(payload)) {
          const errors = [...validator.Errors(payload)].map((e) => ({
            path: e.path,
            message: e.message,
          }));
          throw new QueuePayloadValidationError(jobName, name, errors);
        }
      }
      const opts: JobsOptions & { timeout?: number } = {};
      if (jobDefaults) {
        if (jobDefaults.tries !== undefined) opts.attempts = jobDefaults.tries;
        if (jobDefaults.backoff !== undefined) {
          if (Array.isArray(jobDefaults.backoff)) {
            opts.backoff = { type: "fixed", delay: jobDefaults.backoff[0] ?? 0 };
          } else {
            opts.backoff = jobDefaults.backoff;
          }
        }
        if (jobDefaults.timeout !== undefined) opts.timeout = jobDefaults.timeout;
      }
      return new PendingDispatch({
        queueName: jobDefaults?.onQueue ?? name,
        jobName,
        payload: payload as unknown,
        options: opts,
      });
    }) as DispatcherFn<unknown>;
  }
  return Object.freeze({
    name,
    jobs: Object.freeze({ ...jobs }) as JobMap,
    workerOptions,
    dispatchers: Object.freeze(dispatchers) as DispatchersOf<JobMap>,
    ...(compiledValidators ? { compiledValidators } : {}),
    ...(validateMode ? { validateMode } : {}),
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
 *   const tasksBag = defineQueueBag({ tasks: ExampleQueueDef, alerts: AlertsQueueDef });
 *   constructor(@InjectQueue(tasksBag) private q: BagOf<typeof tasksBag>) {}
 *   await this.q.tasks.add("initiate-task", { taskId });
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
