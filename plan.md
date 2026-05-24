# MQ ergonomics roadmap

Status as of 2026-05-24. **All nine phases shipped.** This document records what was implemented per phase, where the implementation diverged from the original plan, and what follow-up work remains.

| # | Phase | Status | PR | Depends on |
|---|---|---|---|---|
| 1 | Fluent dispatch (Dispatchable + dispatchers map) | ✅ shipped | [#43](https://github.com/kaonashi-dev/techne/pull/43) | — |
| 2 | Class-level defaults (`@Tries` / `@Backoff` / `@Timeout` / `@OnQueue`) | ✅ shipped | — | 1 |
| 3 | `failed()` lifecycle + `@OnFailure` | ✅ shipped | [#46](https://github.com/kaonashi-dev/techne/pull/46) | 1 |
| 4 | `chain([...]).dispatch()` sequential pipelines | ✅ shipped | [#47](https://github.com/kaonashi-dev/techne/pull/47) | 1, 3 |
| 5 | `batch([...]).then/.catch/.finally` fan-out + barrier | ✅ shipped | [#48](https://github.com/kaonashi-dev/techne/pull/48) | 1, 3 |
| 6 | Uniqueness (`@Unique`, `@UniqueUntilProcessing`) | ✅ shipped | [#49](https://github.com/kaonashi-dev/techne/pull/49) | 1 |
| 7 | Per-job middleware (`RateLimited`, `WithoutOverlapping`, `ThrottlesExceptions`) | ✅ shipped | [#50](https://github.com/kaonashi-dev/techne/pull/50) | 1 |
| 8 | `dispatchAfterResponse` (Elysia-integrated) | ✅ shipped | [#45](https://github.com/kaonashi-dev/techne/pull/45) | 1 |
| 9 | Testing helper (`fakeQueue()` + assertions) | ✅ shipped | tbd | 1, 4, 5 |

**Test footprint**: 467 tests pass across 66 files. Of those, 82 belong to MQ-ergonomics phases (split across `tests/mq-*.test.ts`). Build and lint are clean.

---

## Design principles (honored throughout)

1. **Additive, no breakage.** The legacy `@MqProcessor` / `@MqProcess` / `@InjectMq` / `queue.add(name, data)` surface still works. Confirmed by the original `tests/queue.test.ts` (17 tests) staying green across all eight PRs.
2. **One shared core per concern.** Every dispatch path ends in `dispatchToQueue()`. Every failure-handling path is wired through one `worker.on("failed", …)` subscription per worker. Chain and batch metadata travel via the same `JobsOptions` side-channel (`__chainId`, `__chainStepIndex`, `__batchId`).
3. **Zero-cost defaults.** A dispatch with no fluent calls and no class-level config compiles to a single `queue.add(name, data, {})`. Class-level metadata is read once at builder construction; no overhead when absent.
4. **DI is the same DI.** `Dispatchable` subclasses are registered via `@Queueable()` (which wraps `@Injectable()`) and resolved by the existing container. `@Processor` classes unchanged. Middleware are user-instantiated POJOs (deliberate; DI for middleware deferred to v2).
5. **Memory driver covers everything.** Memory `ChainStore`, `BatchStore`, `acquireUniqueLock` / `releaseUniqueLock` all ship in the same PRs as their respective features. Redis impl ships for `ChainStore` and for the uniqueness lock; the **`BatchStore` Redis impl is deferred** (see Follow-ups).
6. **Names come from our framework.** The base class is `Dispatchable`, the decorator is `@Queueable()`. The naming overlap with Laravel's `Queueable` trait is acknowledged in code comments only.
7. **Each PR carries its own tests + docs.** Confirmed across all eight PRs.

---

## Cross-cutting decisions (final)

- **Base class is `Dispatchable<TPayload, TResult>`.** Decorator is `@Queueable()`. Rename of the existing runtime `Job` type deferred to a major.
- **Static `Job.dispatch()` reads from a module-level `QueueResolver`** set during `mq()` plugin setup. One indirect call per dispatch, no DI walk. `withDispatcherContext(resolver, fn)` swaps it for tests.
- **Awaiting `PendingDispatch` is the terminator.** No explicit `.dispatch()` at the end of a chain.
- **Lint rule for unawaited `PendingDispatch` was NOT added.** The footgun remains; current mitigation is the `oxlint-disable-next-line no-thenable` annotation explaining the intent in the source. Add as a follow-up if the footgun bites in practice.
- **Handler bodies live on the Dispatchable subclass.** Job-as-class style and `@Processor`+`@On` coexist; for any given queue, one or the other handles each job name. Two handlers for the same `jobName` on the same queue throws at startup. The duplicate check covers Dispatchable–Dispatchable AND Dispatchable.failed() vs `@OnFailure` overlap (Phase 3).
- **Module-level state used by the dispatch layer**: `activeResolver`, `activeDriver`, `activeChainStore`, `activeBatchStore`, and the ALS `deferredStore`. All cleared in `mq()` plugin's `onShutdown` so test isolation is achievable via `withDispatcherContext`, `clearChainStore`, `clearBatchStore`, etc.

---

## Phase 1 — Fluent dispatch *(shipped — PR #43)*

**Surface** (in `@kaonashi-dev/techne/mq`):

- `abstract class Dispatchable<TPayload, TResult>` — base for the class style. Static methods: `dispatch`, `dispatchSync`, `dispatchIf`, `dispatchUnless` (Phase 8 added `dispatchAfterResponse`; Phase 7 added the optional `middleware()` instance hook).
- `@Queueable()` — class decorator that applies `@Injectable()` and stamps `DISPATCHABLE_MARKER`.
- `class PendingDispatch<TPayload, TResult>` — thenable builder. Phase 1 methods: `.onQueue`, `.delay`, `.tries`, `.backoff`, `.timeout`, `.withId`, `.dispatchIf`, `.dispatchUnless`, `.dispatchSync`. Phase 8 added `.afterResponse()`.
- `defineQueue(...).dispatchers` — per-job-name dispatcher map.
- `setDispatcherContext` / `getDispatcherContext` / `clearDispatcherContext` / `withDispatcherContext`.
- `dispatchToQueue(queueName, jobName, payload, options, uniqueOptions?)` — shared core.
- `registerSyncHandler` / `clearSyncHandlers` — wires `.dispatchSync()`.

**Mechanics**: `mq()` plugin installs `createResolverFromContainer((token) => ctx.resolve(token))` as the active resolver. `MqRegistry.registerDispatchables(classes)` scans providers, groups by `static queue.name`, creates one worker per queue dispatching by `jobName`. Sync handlers registered eagerly during the same scan.

**Acceptance**: 10 tests in `tests/mq-dispatch.test.ts`.

---

## Phase 2 — Class-level defaults *(shipped)*

**Surface**:

- `@Tries(attempts)` — class decorator, sets `MQ_DEFAULT_TRIES` metadata.
- `@Backoff(number | number[] | BackoffOptions)` — sets `MQ_DEFAULT_BACKOFF`.
- `@Timeout(milliseconds)` — sets `MQ_DEFAULT_TIMEOUT`.
- `@OnQueue(queueName)` — sets `MQ_DEFAULT_QUEUE`. At dispatch time this overrides `static queue.name` for the *queue selection only* — the QueueDef-driven typing still applies.

```ts
@Queueable()
@Tries(3)
@Backoff([10_000, 30_000, 60_000])
@Timeout(120_000)
@OnQueue("payins-priority")
class InitiatePayin extends Dispatchable<{ payinId: string }> {
  static queue = PayinsQueueDef;
  async handle({ payinId }) { /* … */ }
}

await InitiatePayin.dispatch({ payinId });             // tries=3, backoff applied
await InitiatePayin.dispatch({ payinId }).tries(5);    // per-call overrides → tries=5
```

**Mechanics**: `buildPendingDispatch(cls, payload)` in `src/mq/dispatchable.ts` reads each metadata key with `getMetadata(...)` and seeds the `JobsOptions` passed to the `PendingDispatch` constructor. Per-call methods on the builder overwrite (not merge). The `@OnQueue` override is applied to `queueName` at the same point.

**Divergence from original plan**: the proposed object-form `defaults:` block on `defineQueue({...})` was **not** shipped. Today, class-level defaults are only available to the Dispatchable style. The contract-API `def.dispatchers.x()` path applies no defaults beyond what's on the `PendingDispatch` per call. Follow-up if needed.

**Acceptance**: 11 tests in `tests/mq-defaults.test.ts`.

---

## Phase 3 — `failed()` lifecycle + `@OnFailure` *(shipped — PR #46)*

**Surface**:

- `failed(payload, error)` — optional instance method on `Dispatchable` subclasses. Runs after the final retry of a failed job.
- `@OnFailure(jobName)` — method decorator placed inside a `@Processor` class. Equivalent for the contract-API style.

```ts
class InitiatePayin extends Dispatchable<{ payinId: string }> {
  static queue = PayinsQueueDef;
  async handle({ payinId }) { /* … */ }
  async failed({ payinId }, error: Error) {
    // Notify ops, mark DB row as DLQ, etc.
  }
}

@Processor(PayinsQueueDef)
class PayinsProcessor {
  @On("initiate-payin")        init(job) { /* … */ }
  @OnFailure("initiate-payin") onInitiateFailed(payload, error) { /* … */ }
}
```

**Mechanics**: `MqRegistry` subscribes once to `worker.on("failed", …)` per worker. On the event, the registry inspects whether `job.state === "failed"` (i.e. retries exhausted) and dispatches to either the Dispatchable's `failed()` method or the matching `@OnFailure`-decorated method. Handler exceptions are caught and logged via `console.error`; they do not re-enter the retry loop.

**Duplicate-handler guard**: at startup, the registry checks every queue+jobName for collisions between Dispatchable subclasses that have a `failed()` method AND any `@OnFailure` decorators on `@Processor` classes covering the same queue. A collision throws.

**Acceptance**: 4 tests in `tests/mq-failure-hooks.test.ts`.

---

## Phase 4 — `chain([...]).dispatch()` *(shipped — PR #47)*

**Surface**:

```ts
import { chain } from "@kaonashi-dev/techne/mq";

await chain([
  InitiatePayin.dispatch({ payinId }),
  PostProcessPayin.dispatch({ payinId, newStatus: "OK" }),
  PublishReceipt.dispatch({ payinId }),
])
  .catch(NotifyOps.dispatch({ payinId, reason: "chain failed" }))
  .dispatch();
```

- `chain(steps: PendingDispatch[])` returns a `ChainBuilder`.
- `ChainBuilder.catch(handler: PendingDispatch)` registers the catch step.
- `ChainBuilder.dispatch()` enqueues step 0 and persists the remaining steps.
- Empty chain → no-op. Single-step chain → bypasses the store entirely.

**Mechanics**:

- `chain([...])` sets `_parked = true` on each step's `PendingDispatch` so awaiting them individually is a no-op (prevents accidental enqueue when the user passes a builder to `chain`).
- `.dispatch()` generates a `chainId`, calls `ChainStore.save(chainId, remainingSteps, catchSpec)`, then enqueues step 0 with `__chainId` and `__chainStepIndex` embedded in `JobsOptions`.
- Registry on successful completion: reads `__chainId` from the completed job, calls `ChainStore.next(chainId)`, enqueues the next step (incrementing `__chainStepIndex`).
- Registry on final failure: reads `__chainId`, calls `ChainStore.catch(chainId)` to get the catch handler, dispatches it, calls `ChainStore.cleanup(chainId)`.

**ChainStore** (`src/mq/chain-store.ts`):

```ts
interface ChainStore {
  save(chainId, remainingSteps, catchSpec?): Promise<void>;
  next(chainId): Promise<ChainStepSpec | null>;
  catch(chainId): Promise<ChainStepSpec | null>;
  cleanup(chainId): Promise<void>;
}
```

- `MemoryChainStore` — `Map<chainId, { steps, catchSpec }>`.
- `RedisChainStore` — single key `chain:{id}` holding a JSON-encoded entry; `del` on cleanup.

**Serialization**: each step is stored as a `ChainStepSpec = { queueName, jobName, payload, options }` — pure data. Closures or function references are never serialized. Extraction via `toPendingDispatchSpec(pendingDispatch)` in `pending-dispatch.ts`.

**Acceptance**: 6 tests in `tests/mq-job-chains.test.ts`.

---

## Phase 5 — `batch([...])` with then/catch/finally *(shipped — PR #48)*

**Surface**:

```ts
import { batch } from "@kaonashi-dev/techne/mq";

const handle = await batch([
  ProcessPodcast.dispatch({ id: 1 }),
  ProcessPodcast.dispatch({ id: 2 }),
  ProcessPodcast.dispatch({ id: 3 }),
])
  .then(NotifySuccess.dispatch({ event: "all-done" }))
  .catch(NotifyOps.dispatch({ event: "some-failed" }))
  .finally(CleanupTemp.dispatch({}))
  .dispatch();

await handle.progress();                                     // { total, completed, failed, cancelled }
await handle.cancel();
await handle.addJobs([ProcessPodcast.dispatch({ id: 4 })]);
```

- `batch(jobs: PendingDispatch[])` returns a `BatchBuilder`.
- Callbacks (`.then`, `.catch`, `.finally`) accept a `PendingDispatch` (not a closure — same serialization rule as Phase 4).
- `.dispatch()` returns a `BatchHandle` with `id`, `progress()`, `cancel()`, `addJobs()`.

**Semantics**:

- `then` fires only if `failed === 0`.
- `catch` fires if `failed > 0`.
- `finally` always fires after `then` or `catch`.
- Empty batch (`total === 0`): callbacks fire immediately on `.dispatch()`.
- `cancel()` flips a flag; in-flight workers finish their current job. New dequeues check `isCancelled` and skip.
- `addJobs` increments `total` atomically (within the memory store's single-threaded JS guarantee) then enqueues.

**Mechanics**:

- `.dispatch()` generates a `batchId`, calls `BatchStore.create(batchId, total, callbacks)`, embeds `__batchId` in each job's `JobsOptions`.
- Registry on completion / failure: increments the relevant counter via `incrementCompleted` / `incrementFailed`. When `completed + failed === total`, calls `fireBatchCallbacks` which reads the callbacks, dispatches the appropriate ones (`then` xor `catch`, then `finally`), and cleans up the store entry.

**BatchStore** (`src/mq/batch-store.ts`):

```ts
interface BatchStore {
  create(batchId, total, callbacks): Promise<void>;
  incrementCompleted(batchId): Promise<BatchProgress>;   // returns post-increment snapshot
  incrementFailed(batchId): Promise<BatchProgress>;
  incrementTotal(batchId, delta): Promise<void>;
  cancel(batchId): Promise<void>;
  isCancelled(batchId): Promise<boolean>;
  getCallbacks(batchId): Promise<BatchCallbacks | null>;
  getState(batchId): Promise<BatchProgress | null>;
  cleanup(batchId): Promise<void>;
}
```

- `MemoryBatchStore` shipped.
- **`RedisBatchStore` NOT shipped** — explicitly deferred. The Redis design (hash with `HINCRBY` for atomic counters) is documented above but unimplemented. Apps using the memory driver are fully functional; Redis-batch is a follow-up.

**Acceptance**: 6 tests in `tests/mq-batch.test.ts`.

---

## Phase 6 — Uniqueness *(shipped — PR #49)*

**Surface**:

```ts
@Queueable()
@Unique({ for: 60_000 })                       // TTL ms; default key = JSON.stringify(payload)
class SendWelcomeEmail extends Dispatchable<{ userId: string }> {
  static queue = NotificationsQueueDef;
  async handle({ userId }) { /* … */ }
}

@Queueable()
@Unique({ for: 60_000, key: (p) => p.userId, throwIfLocked: true })
class GenerateMonthlyReport extends Dispatchable<{ userId: string }> { /* … */ }

@Queueable()
@UniqueUntilProcessing({ for: 30_000 })        // lock released at dequeue, not completion
class SyncInventory extends Dispatchable<void> { /* … */ }
```

**`UniqueOptions`**:

- `for` — TTL in **milliseconds** (not seconds). Document this — easy to misread.
- `key?` — function from payload to dedup string. Defaults to `JSON.stringify(payload)`.
- `throwIfLocked?` — when `true`, a duplicate dispatch throws `JobNotUniqueError`. Otherwise silently dropped (returns `undefined`).

**Mechanics**:

- Class-level metadata read in `buildPendingDispatch()`; produces a `DispatchUniqueOptions` block on the `PendingDispatch`.
- `dispatchToQueue(..., uniqueOptions)` computes `lockKey = ${queueName}:${jobName}:${keyFn(payload)}`, calls `activeDriver.acquireUniqueLock(lockKey, ttlMs)`.
- On success: persists `lockKey` (and `lockUntilProcessing` flag) on the job's `JobsOptions` so the worker knows what to release.
- On failure: silently drop OR throw `JobNotUniqueError` per `throwIfLocked`.
- Worker release: `MqRegistry` releases the lock in the completion path AND in the failure path. For `untilProcessing` mode, release happens immediately on dequeue (before `handle()` runs).

**Driver interface** (in `src/mq/types.ts`):

```ts
interface QueueDriver {
  // ...
  acquireUniqueLock(lockKey: string, ttlMs: number): Promise<boolean>;
  releaseUniqueLock(lockKey: string): Promise<void>;
}
```

- Memory driver: `Map<lockKey, expireAt>` with lazy expiration.
- Redis driver: `SET lockKey 1 NX PX ttlMs`.

**Divergence from original plan**: I had leaned toward "require explicit `keyFn`" — the implementation defaults to `JSON.stringify(payload)` instead. This is more forgiving but means two dispatches with identical payloads dedupe even when the developer didn't think about it. Document this clearly in the public docs.

**Acceptance**: 6 tests in `tests/mq-uniqueness.test.ts`.

---

## Phase 7 — Per-job middleware *(shipped — PR #50)*

**Surface**:

```ts
import { RateLimited, WithoutOverlapping, ThrottlesExceptions } from "@kaonashi-dev/techne/mq";

@Queueable()
class SyncContacts extends Dispatchable<{ userId: string }> {
  static queue = ContactsQueueDef;

  middleware() {
    return [
      new RateLimited("contacts-sync", 10, 60_000),      // 10 / minute
      new WithoutOverlapping(`contacts:${this.userId}`),
      new ThrottlesExceptions(5, 60_000),                // 5 failures / minute
    ];
  }

  async handle({ userId }) { /* … */ }
}
```

**`JobMiddleware` interface** (in `src/mq/types.ts`):

```ts
interface JobMiddleware {
  handle(job: Job, next: () => Promise<unknown>): Promise<unknown>;
}
```

**Mechanics**:

- `MqRegistry` calls `instance.middleware?.() ?? []` per job.
- `buildMiddlewareStack(middlewares, job, handler)` (in `registry.ts`) composes left-to-right: the first middleware is the outermost wrapper.
- Middleware can call `next()` to proceed, throw to fail, or call `job.release(seconds)` to re-enqueue with delay.
- `job.release(seconds)` (in `src/mq/job.ts`) returns `never` — it throws an internal control-flow signal that the worker catches and treats as "re-enqueue with delay, do not count as failure".

**Built-ins**:

- `RateLimited(name, maxPerWindow = 10, windowMs = 60_000)` — process-local token bucket. `clearMiddlewareState()` exported for tests.
- `WithoutOverlapping(key, ttlMs = 60_000)` — reuses the driver's `acquireUniqueLock` / `releaseUniqueLock` from Phase 6. If the lock is held, releases the job for 5 s.
- `ThrottlesExceptions(maxFailures, decayMs)` — process-local failure counter. After `maxFailures` in `decayMs`, releases for the remainder of the window.

**Divergence**: middleware is currently NOT DI-resolvable — instances are constructed by the user in `middleware()`. This was the explicit v1 decision; promote to v2 if real apps need DI'd middleware.

**Process-local state caveat**: `RateLimited` and `ThrottlesExceptions` keep their counters in module-level Maps. Across multiple worker processes they will allow `N * processCount` jobs/window. For true cluster-wide rate limiting, the bucket would need to move to the Redis driver. Document this; OK for now.

**Acceptance**: 6 tests in `tests/mq-job-middleware.test.ts`.

---

## Phase 8 — `dispatchAfterResponse` *(shipped — PR #45)*

**Surface**:

```ts
@Get("/users/:id")
async show(id: string) {
  const user = await this.users.findById(id);
  ViewedProfile.dispatchAfterResponse({ userId: id });   // queued, returns void
  return user;   // response flushes; ViewedProfile dispatches after
}

// Or via fluent builder:
MyJob.dispatch(payload).delay(5_000).afterResponse();
```

- `Dispatchable.dispatchAfterResponse(payload)` — static method, returns `void`.
- `PendingDispatch.afterResponse()` — instance method on the builder. Returns `void`. Lets the caller apply fluent options before deferring.

**Mechanics**:

- ALS via `AsyncLocalStorage<PendingDispatch[]>` in `src/mq/dispatcher.ts`.
- `mq()` plugin wires the lifecycle:
  - On `elysia.onRequest()`: `enterDeferredBuffer()` — installs an empty buffer on the request's async resource via `enterWith` (cheaper than `run()` for hook-based dispatch).
  - On `elysia.onAfterResponse()`: `flushDeferred()` — drains the buffer, `await`ing each `PendingDispatch` in order. Errors logged via `console.error`, never rethrown.
- Outside an HTTP context (`getDeferredBuffer()` returns `undefined`): falls back to fire-and-forget — the dispatch starts immediately, errors are logged.

**Order of operations within a request**: all deferred dispatches fire AFTER the response has been sent. If multiple deferred dispatches were registered, they flush in declaration order.

**Acceptance**: 6 tests in `tests/mq-deferred-dispatch.test.ts`.

---

## Phase 9 — Testing helper *(shipped)*

**Surface** (in `@kaonashi-dev/techne/mq`):

- `fakeQueue()` → `FakeQueue` — recorder that wraps the dispatch layer.
- `FakeQueue.use(fn)` — install the fake for the duration of `fn`, restore prior context on exit.
- `assertDispatched(target, predicate?)` — assert by Dispatchable class OR raw `jobName` string, optionally filtered by payload predicate.
- `assertDispatchedTimes(target, n)`, `assertNotDispatched(target)`, `assertNothingDispatched()`, `assertNothingDispatchedOn(queue)`.
- `assertChained(steps: DispatchableConstructor[])` — match the full step sequence by class identity.
- `assertBatched(predicate: (BatchRecord) => boolean)` — predicate over the full batch (total, jobs, callbacks).
- Inspection: `all()`, `filter(target)`, `chains()`, `batches()` for ad-hoc tests.

**Mechanics**:

- `use()` installs three pieces of context: the dispatcher (via `setDispatcherContext`), a `RecordingChainStore` (via `setChainStore`), and a `RecordingBatchStore` (via `setBatchStore`).
- The fake resolver returns a stub Queue whose `add(name, data, opts)` pushes onto `records` and returns `{ id: "fake-N" }`.
- `RecordingChainStore.save` and `RecordingBatchStore.create` retain enough state for `assertChained` and `assertBatched` to reconstruct chains/batches by `__chainId` / `__batchId` metadata on the dispatched records.
- On `use()` exit: dispatcher context is cleared; chain and batch stores are restored to whatever was set before (typically the memory stores installed by the `mq()` plugin).

**Acceptance**: 10 tests in `tests/mq-testing.test.ts`. 467 total pass. Build + lint clean.

**Divergence from original proposal**: kept the surface intentionally minimal for v1. Did NOT ship:
- A separate `fakeBus()` namespace — chain/batch assertions live on the same `FakeQueue` object.
- `assertChainedTimes()` / `assertBatchedTimes()` — straightforward to add when the v1 surface proves itself.
- `clearAll()` static helper — left to the existing `clear*` exports.

---

## Actual execution order

Different from the originally recommended order. What actually happened:

1. ✅ Phase 1 — fluent dispatch.
2. ✅ Phase 8 — `dispatchAfterResponse` (landed early; small + isolated).
3. ✅ Phase 3 — `failed()` lifecycle + `@OnFailure`.
4. ✅ Phase 4 — chain.
5. ✅ Phase 5 — batch (memory-only; Redis deferred).
6. ✅ Phase 6 — uniqueness.
7. ✅ Phase 7 — middleware.
8. ✅ Phase 2 — class-level defaults (deferred until consumer feedback shaped the metadata names).
9. ✅ Phase 9 — testing helper (added after Phases 4/5 stabilized so chain/batch assertions could be built on the final shape).

The fact that Phase 2 landed late (despite being smallest) is interesting — it gave the decorator names time to be chosen against real chain/batch/uniqueness call sites rather than in isolation. Phase 9 followed the same logic: ship the underlying surface first, then the test helper that asserts against it.

---

## Resolved decisions (was: open questions)

- **Phase 2 — `@Tries`/`@Backoff` on `@Processor`+`@On` users**: NOT shipped. Class-level defaults are Dispatchable-only. Object-form parity is a follow-up.
- **Phase 4/5 — Dispatchable+payload form for chain/batch**: NOT shipped. Today both accept `PendingDispatch[]` only. The "parked builder" mental model turned out to be acceptable in practice.
- **Phase 5 — Cap on `addJobs()`**: not implemented. Documented as a footgun.
- **Phase 6 — Default key for `@Unique`**: defaults to `JSON.stringify(payload)`. More forgiving than the original lean ("require explicit"); document the behavior clearly.
- **Phase 7 — DI-resolvable middleware**: NOT shipped. v1 is user-instantiated POJOs. Promote to v2 if a real use case demands it.
- **Phase 8 — Out-of-HTTP-context behavior**: falls back to fire-and-forget (errors logged via `console.error`, never rethrown). Implemented as planned.

---

## Follow-ups (not blocking)

- **`RedisBatchStore`**: Phase 5 shipped memory-only. The Redis hash + `HINCRBY` design is documented in the original plan; implement when an app needs batch over Redis.
- **Object-form `defaults:` block on `defineQueue`**: would give parity for `def.dispatchers.x()` users. Small.
- **Lint rule for unawaited `PendingDispatch`**: the footgun (`Job.dispatch(payload)` without `await` is a no-op) is real. A custom oxlint rule or a TypeScript wrapper that wraps the return type in a `MustAwait<>` brand could surface it at compile time.
- **DI for middleware**: optional; only if v2 demands it.
- **Cluster-wide rate limiting**: `RateLimited` and `ThrottlesExceptions` are process-local. Moving the bucket / counter to the driver layer is the v2 path.
- **`@Queueable()` → `@Job()` rename**: blocked on renaming the existing runtime `Job` type. Plan as part of a major.
- **bnest overview memory entry**: needs updating to reflect the final MQ surface (single, list, bag, class form, fluent dispatch, chain, batch, uniqueness, middleware, deferred).

---

## Done means *(achieved)*

- ✅ Eight PRs merged.
- ✅ One `tests/mq-{phase}.test.ts` per phase, plus the original `tests/queue.test.ts` and `tests/mq-driver-memory.test.ts` still green.
- ✅ This file updated to reflect the final shipped state.
- ⏳ Bnest overview memory entry to be updated with the final MQ surface — pending.
