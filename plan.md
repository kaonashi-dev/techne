# MQ ergonomics roadmap

Status as of 2026-05-24. Eight phases of work to bring Techne's MQ surface to parity with the developer experience of mature queue frameworks while staying idiomatic to our TS-first, decorator-based core.

| # | Phase | Status | PR | Depends on |
|---|---|---|---|---|
| 1 | Fluent dispatch (Dispatchable + dispatchers map) | ✅ shipped | [#43](https://github.com/kaonashi-dev/techne/pull/43) | — |
| 2 | Class-level defaults (`@Tries` / `@Backoff` / `@Timeout` / `@OnQueue`) | ✅ shipped | — | 1 |
| 3 | `failed()` lifecycle + `@OnFailure` | ✅ shipped | [#46](https://github.com/kaonashi-dev/techne/pull/46) | 1 |
| 4 | `chain([...]).dispatch()` sequential pipelines | ✅ shipped | [#47](https://github.com/kaonashi-dev/techne/pull/47) | 1, 3 |
| 5 | `batch([...]).then/.catch/.finally` fan-out + barrier | ✅ shipped | [#48](https://github.com/kaonashi-dev/techne/pull/48) | 1, 3 |
| 6 | Uniqueness (`@Unique`, `uniqueFor`) | ✅ shipped | [#49](https://github.com/kaonashi-dev/techne/pull/49) | 1 |
| 7 | Per-job middleware (`RateLimited`, `WithoutOverlapping`, …) | ✅ shipped | [#50](https://github.com/kaonashi-dev/techne/pull/50) | 1 |
| 8 | `dispatchAfterResponse` (Elysia-integrated) | ✅ shipped | [#45](https://github.com/kaonashi-dev/techne/pull/45) | 1 |

---

## Design principles (apply to every phase)

1. **Additive, no breakage.** The legacy `@MqProcessor` / `@MqProcess` / `@InjectMq` / `queue.add(name, data)` surface stays working until a major bump. New patterns layer on top.
2. **One shared core per concern.** Every dispatch path ends in `dispatchToQueue()`. Every failure-handling path ends in one worker event. Every lifecycle hook is wired through `MqRegistry`. No parallel code paths.
3. **Zero-cost defaults.** A dispatch with no fluent calls and no class-level config should compile down to the same `queue.add(name, data, {})` call we have today. New features are paid for only when used.
4. **DI is the same DI.** Every class that participates in dispatch (`Dispatchable` subclass, `@Processor` class, `@BatchHandler`, etc.) goes through the existing container with `@Injectable()` semantics. No parallel DI mechanism.
5. **Memory driver covers everything.** Any feature that requires driver work must ship with the memory driver in the same PR. Redis driver work can land in the same PR or as a follow-up.
6. **Names come from our framework, not external libraries.** External names appear in commit messages and design notes only when the precedent matters; never in branch names, file names, or public APIs.
7. **Each PR carries its own tests + docs.** A phase isn't done until `bun test`, `bun run lint`, and `bun run build` are all green, plus a worked example in this file is updated.

---

## Cross-cutting decisions (resolved)

- **Base class is `Dispatchable<TPayload, TResult>`.** Renaming the existing `Job` runtime type would silently break every handler signature. The decorator is `@Queueable()`. Revisit at a major.
- **Static `Job.dispatch()` reads from a module-level `QueueResolver`** set by `mq()` plugin setup. One indirect call per dispatch, no DI walk. Tests use `withDispatcherContext(resolver, fn)` for isolation.
- **Awaiting `PendingDispatch` is the terminator.** No explicit `.dispatch()` at the end of a chain. Lint rule for unawaited builders will be added in Phase 7 alongside the middleware pipeline scan.
- **Handler bodies live on the Dispatchable subclass.** The Job-as-class style and the `@Processor`+`@On` style coexist; for any given queue, one or the other handles each job name. Two handlers for the same `jobName` on the same queue throws at startup (Phase 1 already enforces this for Dispatchable–Dispatchable; Phase 3 extends to Dispatchable–`@OnFailure` collisions).

---

## Phase 1 — Fluent dispatch *(shipped)*

**Goal**: replace `queue.add("name", data, opts)` with a single fluent statement at every dispatch site, in both class and contract-API styles.

**Surface shipped (in `@kaonashi-dev/techne/mq`)**:

- `abstract class Dispatchable<TPayload, TResult>` — base for the class style.
- `@Queueable()` — class decorator that applies `@Injectable()` and stamps the `DISPATCHABLE_MARKER`.
- `class PendingDispatch<TPayload, TResult>` — thenable builder.
  Methods: `.onQueue`, `.delay`, `.tries`, `.backoff`, `.timeout`, `.withId`, `.dispatchIf`, `.dispatchUnless`, `.dispatchSync`.
- `defineQueue(...).dispatchers` — per-job-name dispatcher map, typed from the def's `jobs`.
- `setDispatcherContext` / `getDispatcherContext` / `clearDispatcherContext` / `withDispatcherContext` — module-level resolver lifecycle.
- `dispatchToQueue(queueName, jobName, payload, options)` — core shared by every path.
- `registerSyncHandler` / `clearSyncHandlers` — wires `.dispatchSync()` to the actual handler body without going through the driver.

**Mechanics**:

- `mq()` plugin installs `createResolverFromContainer((token) => ctx.resolve(token))` as the active resolver; clears on shutdown.
- `MqRegistry.registerDispatchables(classes)` scans providers, groups by `static queue.name`, creates one worker per queue dispatching by `jobName` to the right Dispatchable instance.
- Sync handlers are registered eagerly during the same scan so `.dispatchSync()` works without the worker loop.

**Acceptance**: ✅ 10 new tests in `tests/mq-dispatch.test.ts`. 406 total pass. Build + lint clean.

---

## Phase 2 — Class-level defaults *(shipped)*

**Acceptance**: ✅ 11 new tests in `tests/mq-defaults.test.ts`. 417 total pass. Build + lint clean.

---

## Phase 2 — Class-level defaults

**Goal**: let a job declare its own retry/timeout/queue policy once, in the class, so every dispatch site doesn't repeat `.tries(3).backoff([10,30,60])`.

**API**:

```ts
@Queueable()
@Tries(3)
@Backoff([10_000, 30_000, 60_000])
@Timeout(120_000)
@OnQueue("payins-priority")
class InitiatePayin extends Dispatchable<{ payinId: string }> {
  static queue = PayinsQueueDef;
  async handle({ payinId }: { payinId: string }) { /* … */ }
}

// Per-call override wins:
await InitiatePayin.dispatch({ payinId }).tries(5);          // 5, not 3
await InitiatePayin.dispatch({ payinId });                    // 3 (default)
```

Equivalent on object-form defs without forcing a Dispatchable class:

```ts
const PayinsQueueDef = defineQueue({
  name: "payins",
  jobs: { "initiate-payin": {} as { payinId: string } },
  defaults: {
    "initiate-payin": { tries: 3, backoff: [10_000, 30_000, 60_000] },
  },
});
```

**Mechanics**:

- Each decorator stores its value via the framework's `defineMetadataFromContext` helper under a new constant (`MQ_DEFAULT_TRIES`, etc.).
- `Dispatchable.dispatch()` reads the metadata block at builder-construction time, seeds `PendingDispatch.options` with the defaults.
- `defineQueue({..., defaults})` reads from the `defaults` field analogously when creating the dispatcher map.
- Per-call methods on `PendingDispatch` overwrite, not merge — predictable.

**Gotchas**:

- Don't apply class defaults at *handler*-side (e.g., when the worker resolves the lockDuration). Those come from `WorkerOptions` on the QueueDef. Defaults here are **dispatch-time** policy only.
- The defaults block on `defineQueue` is type-checked against the job-name set (TS error if you add defaults for a job that isn't declared).

**Tests**:

- Decorator-only defaults applied when no per-call override.
- Per-call override wins.
- Object-form `defaults` block applied via dispatchers map.
- Defaults compose with both `.dispatch()` and `.dispatchSync()`.

**Scope**: 1 small PR, ~150 LOC + tests. No driver changes.

---

## Phase 3 — `failed()` lifecycle + `@OnFailure`

**Goal**: run cleanup / notification logic once a job has exhausted its retries. Two surfaces, one mechanism.

**API**:

```ts
// Class style
class InitiatePayin extends Dispatchable<{ payinId: string }> {
  static queue = PayinsQueueDef;
  async handle({ payinId }) { /* … */ }
  async failed({ payinId }: { payinId: string }, error: Error) {
    // Notify ops, mark DB row as DLQ, etc.
  }
}

// Processor style
@Processor(PayinsQueueDef)
class PayinsProcessor {
  @On("initiate-payin") init(job) { /* … */ }
  @OnFailure("initiate-payin") onInitiateFailed(job, error: Error) { /* … */ }
}
```

**Mechanics**:

- Worker already emits a `failed` event on the runtime `Worker` after `driver.fail()` when no retries remain.
- New: `MqRegistry` tracks `{ queueName, jobName } → failureHandler` during the same scan that registers handlers.
- Subscribes once per Worker; on `failed`, looks up the handler and invokes it with `(payload, error)`.
- For Dispatchable subclasses: detect a `failed` method on the prototype, register it.
- For `@OnFailure`: new decorator + metadata key (`MQ_ON_FAILURE_METADATA`) similar to `MQ_PROCESS_METADATA`.

**Gotchas**:

- `failed()` must run with a DI-resolved instance (deps injected). For Dispatchable, the registry already resolves the class per job; for `@Processor`, it already holds the instance.
- A `failed` handler that itself throws should NOT re-trigger retries — log and swallow. Add a try/catch in the registry's failure path.
- If both a Dispatchable's `failed` method AND an `@OnFailure` exist for the same `jobName`, throw at startup (mirrors the duplicate-handler check in Phase 1).

**Tests**:

- `failed()` fires after the final retry, never on intermediate failures.
- `@OnFailure` fires for the right `jobName`.
- Handler-thrown error in `failed()` is logged, doesn't re-enter retry loop.
- Duplicate handler → startup error.

**Scope**: 1 small PR, ~100 LOC + tests. No driver changes (worker already emits the event).

---

## Phase 4 — `chain([...]).dispatch()` sequential pipelines

**Goal**: enqueue a series of jobs that run one after another, with the second only starting after the first completes.

**API**:

```ts
import { chain } from "@kaonashi-dev/techne/mq";

await chain([
  InitiatePayin.dispatch({ payinId }),
  PostProcessPayin.dispatch({ payinId, newStatus: "OK" }),
  PublishReceipt.dispatch({ payinId }),
])
  .catch((err) => NotifyOps.dispatch({ payinId, err: err.message }))
  .dispatch();
```

**Mechanics**:

- `chain([...])` accepts `PendingDispatch[]`. Each builder gets a `__chainParked = true` flag that prevents `await`-time auto-enqueue.
- The resulting `ChainBuilder` has `.catch(handler)`, `.dispatch()`.
- On `.dispatch()`:
  1. Generate a `chainId` (UUID).
  2. Persist `[step2, step3, …, catchHandler]` to a new driver primitive: `ChainStore.save(chainId, steps)`.
  3. Enqueue step 1 with `{ chainId, chainStepIndex: 0 }` as side-channel metadata in `JobsOptions`.
- On successful completion of a chained job, the registry inspects the metadata, asks `ChainStore.next(chainId, currentIndex)` for the next step, enqueues it.
- On failure (after retries exhausted) of any chained job, registry asks `ChainStore.catch(chainId)` for the catch handler and dispatches it; the rest of the chain is discarded.

**Driver additions**:

```ts
interface ChainStore {
  save(chainId: string, steps: ChainStepSpec[]): Promise<void>;
  next(chainId: string, completedIndex: number): Promise<ChainStepSpec | null>;
  catch(chainId: string): Promise<ChainStepSpec | null>;
  cleanup(chainId: string): Promise<void>;
}
```

Memory driver: a `Map<chainId, ChainStepSpec[]>`.
Redis driver: a single key `chain:{id}` holding a JSON array; LREM after each step.

**Serialization concern**:

A step spec must be reconstructable to a `PendingDispatch` without the original closure. We serialize the (queueName, jobName, payload, options) tuple — pure data. The catch handler is a `PendingDispatch` of its own, which already carries this tuple. No function serialization, no closure capture.

**Gotchas**:

- `chain([])` (empty) is a no-op. `chain([x])` is equivalent to `x.dispatch()`.
- `chain` jobs MUST be Dispatchable-backed or registered in the QueueDef. We're enqueueing by `(queueName, jobName)`; reach-ability is already validated.
- If a chain job's `failed()` re-enqueues itself, we end up in a loop. Decision: `failed()` runs OUTSIDE the chain context (no `chainId` set on its dispatches), so retrying is fine but won't re-enter the chain.
- `ChainStore.cleanup(chainId)` called after final step completes OR catch handler dispatches.

**Tests**:

- Three-job chain runs in order.
- Mid-chain failure triggers catch handler, skips remaining steps.
- Empty / single-element chain.
- Chain with delayed steps (per-step `.delay()` honored).
- Catch handler that itself fails is logged but doesn't loop.

**Scope**: 1 medium PR, ~250 LOC + memory driver + Redis driver + tests. Bumps the driver interface (minor breaking change for custom drivers; document in CHANGELOG).

---

## Phase 5 — `batch([...]).then/.catch/.finally` fan-out + barrier

**Goal**: enqueue N jobs that run in parallel, with callbacks fired when all complete (or any fail, or both).

**API**:

```ts
import { batch } from "@kaonashi-dev/techne/mq";

const handle = await batch([
  ProcessPodcast.dispatch({ id: 1 }),
  ProcessPodcast.dispatch({ id: 2 }),
  ProcessPodcast.dispatch({ id: 3 }),
])
  .then((b) => NotifySuccess.dispatch({ batchId: b.id, total: b.total }))
  .catch((b, err) => NotifyOps.dispatch({ batchId: b.id, err: err.message }))
  .finally((b) => CleanupTemp.dispatch({ batchId: b.id }))
  .dispatch();

// Later:
const progress = await handle.progress();   // { total, completed, failed, cancelled }
await handle.cancel();
await handle.addJobs([ProcessPodcast.dispatch({ id: 4 })]);
```

**Mechanics**:

- `batch([...])` returns a `BatchBuilder` with `.then(pd)`, `.catch(pd)`, `.finally(pd)`, `.dispatch()`.
- Callbacks are `PendingDispatch` instances (NOT closures) — same serialization rule as Phase 4.
- On `.dispatch()`:
  1. Generate a `batchId`.
  2. Persist `{ total: N, completed: 0, failed: 0, cancelled: false, callbacks: {then, catch, finally} }` to `BatchStore.create(batchId, total, callbacks)`.
  3. Enqueue all N jobs with `{ batchId }` side-channel metadata.
  4. Return a `BatchHandle` with `id`, `progress()`, `cancel()`, `addJobs()`.
- Registry on each chained job:
  - On dequeue: if `cancelled`, fail-fast and skip handler.
  - On completion: `BatchStore.incrementCompleted(batchId)`. If `completed + failed === total`, fire `then` (if no failures) or `catch` (if any), then `finally`.
  - On failure (after retries): `BatchStore.incrementFailed(batchId)`. Same barrier check.
- `addJobs`: `BatchStore.incrementTotal(batchId, delta)` + enqueue with metadata.

**Driver additions**:

```ts
interface BatchStore {
  create(batchId: string, total: number, callbacks: BatchCallbacks): Promise<void>;
  incrementCompleted(batchId: string): Promise<{ completed: number; failed: number; total: number }>;
  incrementFailed(batchId: string): Promise<{ completed: number; failed: number; total: number }>;
  incrementTotal(batchId: string, delta: number): Promise<void>;
  cancel(batchId: string): Promise<void>;
  isCancelled(batchId: string): Promise<boolean>;
  getCallbacks(batchId: string): Promise<BatchCallbacks | null>;
  cleanup(batchId: string): Promise<void>;
}
```

Memory: a `Map<batchId, BatchState>`.
Redis: hash `batch:{id}` with fields `total`, `completed`, `failed`, `cancelled`, and JSON-encoded `callbacks`. Use `HINCRBY` for counters — atomic.

**Gotchas**:

- The barrier check (`completed + failed === total`) is racy without atomic increment-and-return. Redis `HINCRBY` returns the new value; memory impl wraps in a critical section (single-threaded JS makes this trivial). Drivers must return the post-increment snapshot.
- `then` vs `catch`: `then` fires only if `failed === 0`. `catch` fires if `failed > 0`. `finally` always fires. Match Laravel's semantics here exactly because the precedent is well-known.
- `cancel()` flips a flag but doesn't drain in-flight workers — they finish their current job and check the flag on next dequeue. Acceptable.
- `addJobs` after the batch has already completed: undefined behavior. Throw.

**Tests**:

- All-succeed → `then` + `finally` fire once each, in order.
- Any-fail → `catch` + `finally` fire (NOT `then`).
- `cancel()` mid-flight skips remaining unstarted jobs.
- `addJobs()` extends total, eventually triggers callbacks.
- Progress reflects intermediate state.
- Memory driver matches Redis driver behavior under the same scenarios (parametrized test suite).

**Scope**: 1 large PR, ~400 LOC + memory driver + Redis driver + tests. Heaviest of the eight phases. Probably 2-3 review cycles.

---

## Phase 6 — Uniqueness

**Goal**: prevent the same logical job from being queued more than once at a time.

**API**:

```ts
@Queueable()
@Unique({ for: 3600, key: (payload: { userId: string }) => payload.userId })
class GenerateMonthlyReport extends Dispatchable<{ userId: string }> {
  static queue = ReportsQueueDef;
  async handle({ userId }) { /* … */ }
}

// Two concurrent dispatches → second is dropped (or throws, configurable)
await GenerateMonthlyReport.dispatch({ userId: "u1" });   // enqueues
await GenerateMonthlyReport.dispatch({ userId: "u1" });   // no-op (within 3600s)
```

`@UniqueUntilProcessing` releases the lock when the worker dequeues the job rather than when it completes.

**Mechanics**:

- `@Unique` stores `{ ttl, keyFn, mode }` metadata on the class.
- Dispatch path:
  1. If metadata present, compute `lockKey = ${queueName}:${jobName}:${keyFn(payload)}`.
  2. Call `driver.acquireUniqueLock(lockKey, ttlMs)`.
  3. If `true`, proceed with normal enqueue; record the lockKey on the job's options.
  4. If `false`, drop silently (or throw `JobNotUniqueError` if `{ throwIfLocked: true }`).
- For `UniqueUntilProcessing`: registry releases the lock at dequeue. For `Unique`: release at completion or failure.

**Driver additions**:

```ts
interface QueueDriver {
  // ...
  acquireUniqueLock(lockKey: string, ttlMs: number): Promise<boolean>;
  releaseUniqueLock(lockKey: string): Promise<void>;
}
```

Memory: `Map<lockKey, expireAt>` with lazy expiration.
Redis: `SET lockKey 1 NX PX ttlMs` returns "OK" or null.

**Gotchas**:

- Lock release must be idempotent (calling `releaseUniqueLock` on an already-released key is a no-op).
- If `keyFn` throws, drop the dispatch and surface the error to the caller (don't silently lose).
- Multi-process workers: the Redis driver's SETNX is atomic; the memory driver is single-process by definition.
- Lock TTL must be > expected job duration + retry backoff sum. Document this trap.

**Tests**:

- Same key dispatched twice → second is dropped.
- After TTL, dispatch succeeds again.
- `UniqueUntilProcessing` releases on dequeue (third dispatch during processing succeeds).
- `throwIfLocked` mode throws.
- Memory + Redis parametrized.

**Scope**: 1 small-medium PR, ~200 LOC + memory driver + Redis driver + tests.

---

## Phase 7 — Per-job middleware pipeline

**Goal**: composable cross-cutting concerns (rate limit, no-overlap, throttle-on-exception) without subclassing or wrapping.

**API**:

```ts
import { RateLimited, WithoutOverlapping, ThrottlesExceptions } from "@kaonashi-dev/techne/mq";

@Queueable()
class SyncContacts extends Dispatchable<{ userId: string }> {
  static queue = ContactsQueueDef;

  middleware() {
    return [
      new RateLimited("contacts-sync"),
      new WithoutOverlapping(this.userId),
      new ThrottlesExceptions(5, 60_000),
    ];
  }

  async handle({ userId }) { /* … */ }
}
```

A middleware is `{ handle(job: Job, next: () => Promise<unknown>): Promise<unknown> }`.

**Mechanics**:

- Registry composes middleware around the handler call:
  ```ts
  const stack = middlewares.reduceRight(
    (next, mw) => () => mw.handle(job, next),
    () => instance.handle(job.data),
  );
  await stack();
  ```
- Middleware can:
  - Call `next()` to proceed.
  - Throw to fail the job.
  - Call `job.release(seconds)` to re-enqueue (worker exposes this via the runtime Job context).

**Built-ins**:

- `RateLimited(name)` — uses a token-bucket entry per `name`. Releases the job for `bucket.retryAfter` seconds if limited.
- `WithoutOverlapping(key)` — acquires a lock for `key` before running; releases on completion/failure. Built on the same `acquireUniqueLock` primitive from Phase 6.
- `ThrottlesExceptions(maxFails, decayMs)` — if `maxFails` failures happen within `decayMs`, releases the job for `decayMs` instead of retrying immediately.

**`job.release(seconds)`**:

- New method on the runtime `Job` class. Calls into driver to re-enqueue with `delay`.
- Stops the current attempt without counting as a failure (no retry counter increment).
- Drivers already support delay; just need to wire the API.

**Gotchas**:

- Middleware order matters and is left-to-right: outermost first. Document this.
- `WithoutOverlapping` reuses the unique-lock driver primitive from Phase 6 — Phase 7 should land after Phase 6 OR they share the same PR.
- `RateLimited` needs a separate "token bucket" registry — define it as a framework-level service so HTTP routes can use it too.

**Tests**:

- Middleware chain runs in declared order, around the handler.
- A middleware that doesn't call `next()` skips the handler entirely.
- `release(seconds)` re-enqueues with the delay, doesn't increment attempt count.
- `RateLimited` limits as expected.
- `WithoutOverlapping` prevents concurrent runs.

**Scope**: 1 medium PR, ~250 LOC + tests. Built-ins can be separate PRs after the pipeline lands.

---

## Phase 8 — `dispatchAfterResponse`

**Goal**: defer dispatch until the HTTP response has been flushed to the client. Useful for tracking, notifications, side-effects that shouldn't add to request latency.

**API**:

```ts
@Get("/users/:id")
async show(id: string) {
  const user = await this.users.findById(id);
  await ViewedProfile.dispatchAfterResponse({ userId: id });   // queued, not awaited yet
  return user;   // response flushes
  // ViewedProfile actually dispatches AFTER this point
}
```

**Mechanics**:

- `Dispatchable.dispatchAfterResponse(payload)` and `PendingDispatch.afterResponse()` push the dispatch into an ALS-scoped buffer.
- Framework registers an Elysia `onAfterResponse` hook that flushes the buffer for the current request.
- Outside an HTTP context (background job triggering another job), `afterResponse` falls back to immediate dispatch.

**Gotchas**:

- ALS context must be propagated through `await` boundaries. The logger plugin already does this (memory entry confirms `AsyncLocalStorage requestId propagation`).
- If the response handler throws, deferred dispatches still fire (matches the "this happens for sure" mental model). Document this.
- A deferred dispatch that itself throws during flush is logged, not rethrown — we can't surface errors after the response is gone.
- `dispatchSync` deferred-then-immediate is nonsensical — error if both are combined.

**Tests**:

- Inside an HTTP request, deferred dispatches fire after response flush (verifiable by setting a flag in the handler and checking after).
- Outside an HTTP request, falls back to immediate dispatch.
- Deferred dispatch errors are logged, not rethrown.
- Multiple deferred dispatches in one request: all flush, in order.

**Scope**: 1 small PR, ~150 LOC + tests. Touches the HTTP plugin layer.

---

## Execution order

The dependency graph allows parallelization after Phase 1 is in. Recommended order, optimized for small/isolated PRs first:

1. ✅ **Phase 1** — shipped.
2. **Phase 2** — defaults. Tiny, isolated, unblocks consumer migration.
3. **Phase 3** — `failed()` hook. Tiny, isolated, prerequisite for 4/5.
4. **Phase 6** — uniqueness. Medium, isolated. Lands the lock primitive used by Phase 7.
5. **Phase 7** — middleware. Medium, reuses Phase 6's lock.
6. **Phase 8** — `dispatchAfterResponse`. Small, touches HTTP plugin — can land any time after Phase 1.
7. **Phase 4** — chain. Medium, needs Phase 3.
8. **Phase 5** — batch. Largest of the set; intentionally last.

After all eight: revisit the bnest overview memory and update the MQ surface section. Open a tracking issue per phase as it begins so PR reviewers can cross-reference the design here.

---

## Open questions (resolve before starting each phase)

- **Phase 2**: Should `@Tries`/`@Backoff` work on the runtime `Job` argument too (for `@Processor`+`@On` users), or only on `Dispatchable` subclasses? Probably yes via metadata on the `@On` method — keep API parity.
- **Phase 4/5**: Should chain/batch jobs accept the **Dispatchable class + payload** form too (`chain([{ job: InitiatePayin, payload: {…} }, …])`)? That's less typing than `Dispatchable.dispatch(p)` and avoids the "parked builder" mental model. Lean toward yes; ship both.
- **Phase 5**: Cap on `addJobs()`? A batch with unbounded growth could DoS the BatchStore. Probably not for v1 — document as a footgun.
- **Phase 6**: When `keyFn` is missing, default to `JSON.stringify(payload)`? Or require explicit? Laravel requires explicit. Lean toward explicit (forces the user to think about what makes the job unique).
- **Phase 7**: Should middleware be DI-resolvable (instances created by the container)? Adds complexity. v1: pure data classes, instantiated by the user. v2: optional DI.
- **Phase 8**: Buffer per-request? Per-context? What happens if the user dispatches deferred from inside a worker that's processing a job triggered by an HTTP request long ago? Probably "no ALS context, fall back to immediate" — explicit and predictable.

---

## Done means

- Eight PRs merged, each with the acceptance criteria in its section.
- `tests/queue.test.ts`, `tests/mq-dispatch.test.ts`, plus one new `tests/mq-{phase}.test.ts` per phase.
- This file updated as each phase ships: status table at top, PR link in the row.
- Bnest overview memory entry updated with the final MQ surface once Phase 8 lands.
