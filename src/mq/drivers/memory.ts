import type { EventEmitter } from "node:events";
import { getMqEventBus } from "../event-bus";
import { MissingLockError } from "../errors";
import type {
  ClaimNextOptions,
  JobJson,
  JobsOptions,
  JobState,
  QueueDriver,
  QueueEvent,
} from "../types";

interface DelayedEntry {
  jobId: string;
  dueAt: number;
}

interface Deque {
  items: string[];
  head: number;
}

interface MemoryQueueState {
  jobs: Map<string, JobJson>;
  waiting: Deque;
  pausedJobs: Deque;
  delayed: DelayedEntry[];
  paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
  waiters: Set<() => void>;
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneJob<T = unknown, R = unknown>(job: JobJson<T, R>): JobJson<T, R> {
  return {
    ...job,
    data: cloneValue(job.data),
    opts: { ...job.opts },
    progress: cloneValue(job.progress),
    stacktrace: [...job.stacktrace],
    returnValue: job.returnValue === undefined ? undefined : cloneValue(job.returnValue),
  };
}

function normalizeOptions(options: JobsOptions): JobsOptions {
  return {
    attempts: options.attempts ?? 1,
    delay: options.delay ?? 0,
    removeOnComplete: options.removeOnComplete ?? false,
    removeOnFail: options.removeOnFail ?? false,
    backoff: options.backoff,
    jobId: options.jobId,
    // Chain side-channel fields — must be preserved so the worker can advance the chain.
    __chainId: options.__chainId,
    __chainStepIndex: options.__chainStepIndex,
    // Batch side-channel field — must be preserved so the barrier can count completions.
    __batchId: options.__batchId,
    lockKey: options.lockKey,
    lockUntilProcessing: options.lockUntilProcessing,
  };
}

function createDeque(): Deque {
  return {
    items: [],
    head: 0,
  };
}

function enqueue(deque: Deque, value: string): void {
  deque.items.push(value);
}

function dequeue(deque: Deque): string | undefined {
  const value = deque.items[deque.head];
  if (value === undefined) {
    return undefined;
  }

  deque.head += 1;
  if (deque.head > 1_024 && deque.head * 2 >= deque.items.length) {
    deque.items = deque.items.slice(deque.head);
    deque.head = 0;
  }

  return value;
}

function drainDeque(deque: Deque): string[] {
  const items = deque.items.slice(deque.head);
  deque.items = [];
  deque.head = 0;
  return items;
}

function heapPeek(heap: DelayedEntry[]): DelayedEntry | undefined {
  return heap[0];
}

function heapPush(heap: DelayedEntry[], value: DelayedEntry): void {
  heap.push(value);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent]!.dueAt <= heap[index]!.dueAt) break;
    [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
    index = parent;
  }
}

function heapPop(heap: DelayedEntry[]): DelayedEntry | undefined {
  if (heap.length === 0) return undefined;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last) {
    heap[0] = last;
    let index = 0;

    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < heap.length && heap[left]!.dueAt < heap[smallest]!.dueAt) {
        smallest = left;
      }
      if (right < heap.length && heap[right]!.dueAt < heap[smallest]!.dueAt) {
        smallest = right;
      }
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
      index = smallest;
    }
  }

  return first;
}

export class MemoryQueueDriver implements QueueDriver {
  private queues = new Map<string, MemoryQueueState>();
  private uniqueLocks = new Map<string, number>();

  async add<T>(
    queueName: string,
    name: string,
    data: T,
    options: JobsOptions,
  ): Promise<JobJson<T>> {
    const state = this.getState(queueName);
    const normalized = normalizeOptions(options);
    const now = Date.now();
    const id = normalized.jobId ?? crypto.randomUUID();

    const job: JobJson<T> = {
      id,
      name,
      data: cloneValue(data),
      queueName,
      opts: normalized,
      state:
        normalized.delay && normalized.delay > 0 ? "delayed" : state.paused ? "paused" : "waiting",
      timestamp: now,
      attemptsMade: 0,
      progress: 0,
      delayUntil: normalized.delay && normalized.delay > 0 ? now + normalized.delay : undefined,
      stacktrace: [],
      stalledCount: 0,
    };

    state.jobs.set(id, job);

    if (job.state === "delayed") {
      heapPush(state.delayed, { jobId: id, dueAt: job.delayUntil! });
      this.scheduleDelayed(queueName, state);
    } else if (job.state === "paused") {
      enqueue(state.pausedJobs, id);
    } else {
      enqueue(state.waiting, id);
      this.emitEvent(queueName, { event: "waiting", payload: { jobId: id } });
      this.notifyWaiters(state);
    }

    return cloneJob(job);
  }

  async addBulk<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; opts: JobsOptions }>,
  ): Promise<Array<JobJson<T>>> {
    const added: Array<JobJson<T>> = [];
    for (const job of jobs) {
      added.push(await this.add(queueName, job.name, job.data, job.opts));
    }
    return added;
  }

  async claimNext(queueName: string, options: ClaimNextOptions): Promise<JobJson | null> {
    const state = this.getState(queueName);
    const startedAt = Date.now();
    const timeout = options.blockTimeout ?? 0;

    while (true) {
      this.promoteDelayed(queueName, state);

      if (!state.paused) {
        const id = dequeue(state.waiting);
        if (id) {
          const job = state.jobs.get(id);
          if (job) {
            const now = Date.now();
            job.state = "active";
            job.processedOn = now;
            job.lockToken = options.lockToken;
            job.lockExpiresAt = now + options.lockDuration;
            this.emitEvent(queueName, { event: "active", payload: { jobId: id } });
            return cloneJob(job);
          }
        }
      }

      const elapsed = Date.now() - startedAt;
      const remaining = timeout - elapsed;
      if (remaining <= 0) {
        return null;
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          state.waiters.delete(finish);
          resolve();
        };
        state.waiters.add(finish);
        setTimeout(finish, remaining);
      });
    }
  }

  async extendLock(
    queueName: string,
    jobId: string,
    lockToken: string,
    duration: number,
  ): Promise<boolean> {
    const job = this.getState(queueName).jobs.get(jobId);
    if (!job || job.lockToken !== lockToken || job.state !== "active") return false;
    job.lockExpiresAt = Date.now() + duration;
    return true;
  }

  async complete<R>(
    queueName: string,
    jobId: string,
    lockToken: string,
    returnValue?: R,
  ): Promise<void> {
    const state = this.getState(queueName);
    const job = state.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);

    job.state = "completed";
    job.returnValue = returnValue === undefined ? undefined : cloneValue(returnValue);
    job.finishedOn = Date.now();
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;

    this.emitEvent(queueName, {
      event: "completed",
      payload: { jobId, returnValue: job.returnValue },
    });

    if (job.opts.removeOnComplete) {
      state.jobs.delete(jobId);
    }
  }

  async fail(
    queueName: string,
    jobId: string,
    lockToken: string,
    error: Error,
    retryAt?: number,
  ): Promise<void> {
    const state = this.getState(queueName);
    const job = state.jobs.get(jobId);
    if (!job || job.lockToken !== lockToken) throw new MissingLockError(jobId);

    job.attemptsMade += 1;
    job.failedReason = error.message;
    job.stacktrace.push(error.stack ?? error.message);
    job.lockToken = undefined;
    job.lockExpiresAt = undefined;

    if (retryAt && job.attemptsMade < (job.opts.attempts ?? 1)) {
      job.state = "delayed";
      job.delayUntil = retryAt;
      heapPush(state.delayed, { jobId, dueAt: retryAt });
      this.scheduleDelayed(queueName, state);
      return;
    }

    job.state = "failed";
    job.finishedOn = Date.now();
    this.emitEvent(queueName, {
      event: "failed",
      payload: { jobId, failedReason: job.failedReason },
    });
    if (job.opts.removeOnFail) {
      state.jobs.delete(jobId);
    }
  }

  async requeueStalled(queueName: string, maxStalledCount: number): Promise<string[]> {
    const state = this.getState(queueName);
    const now = Date.now();
    const requeued: string[] = [];

    for (const job of state.jobs.values()) {
      if (job.state !== "active" || !job.lockExpiresAt || job.lockExpiresAt > now) {
        continue;
      }

      job.lockToken = undefined;
      job.lockExpiresAt = undefined;
      job.stalledCount += 1;

      if (job.stalledCount > maxStalledCount) {
        job.state = "failed";
        job.failedReason = "job stalled more than allowable limit";
        job.finishedOn = now;
        this.emitEvent(queueName, {
          event: "failed",
          payload: { jobId: job.id, failedReason: job.failedReason },
        });
        continue;
      }

      job.state = state.paused ? "paused" : "waiting";
      if (state.paused) {
        enqueue(state.pausedJobs, job.id);
      } else {
        enqueue(state.waiting, job.id);
        this.notifyWaiters(state);
      }
      requeued.push(job.id);
      this.emitEvent(queueName, {
        event: "stalled",
        payload: { jobId: job.id },
      });
    }

    return requeued;
  }

  async updateProgress(queueName: string, jobId: string, progress: number | object): Promise<void> {
    const job = this.getState(queueName).jobs.get(jobId);
    if (!job) return;
    job.progress = cloneValue(progress);
    this.emitEvent(queueName, {
      event: "progress",
      payload: { jobId, data: job.progress },
    });
  }

  async getJob<T = unknown, R = unknown>(
    queueName: string,
    jobId: string,
  ): Promise<JobJson<T, R> | null> {
    const job = this.getState(queueName).jobs.get(jobId);
    return job ? cloneJob(job as JobJson<T, R>) : null;
  }

  async getJobCounts(
    queueName: string,
    states?: JobState[],
  ): Promise<Partial<Record<JobState, number>>> {
    const state = this.getState(queueName);
    this.promoteDelayed(queueName, state);

    const counts: Partial<Record<JobState, number>> = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };

    for (const job of state.jobs.values()) {
      counts[job.state] = (counts[job.state] ?? 0) + 1;
    }

    if (!states || states.length === 0) {
      return counts;
    }

    return Object.fromEntries(
      states.map((jobState) => [jobState, counts[jobState] ?? 0]),
    ) as Partial<Record<JobState, number>>;
  }

  async pause(queueName: string): Promise<void> {
    const state = this.getState(queueName);
    state.paused = true;
  }

  async resume(queueName: string): Promise<void> {
    const state = this.getState(queueName);
    state.paused = false;
    for (const jobId of drainDeque(state.pausedJobs)) {
      const job = state.jobs.get(jobId);
      if (!job || job.state !== "paused") continue;
      job.state = "waiting";
      enqueue(state.waiting, jobId);
      this.emitEvent(queueName, { event: "waiting", payload: { jobId } });
    }
    this.promoteDelayed(queueName, state);
    this.notifyWaiters(state);
  }

  async acquireUniqueLock(lockKey: string, ttlMs: number): Promise<boolean> {
    const existingExpiry = this.uniqueLocks.get(lockKey);
    if (existingExpiry !== undefined && existingExpiry > Date.now()) {
      return false;
    }
    this.uniqueLocks.set(lockKey, Date.now() + ttlMs);
    return true;
  }

  async releaseUniqueLock(lockKey: string): Promise<void> {
    this.uniqueLocks.delete(lockKey);
  }

  async close(): Promise<void> {
    for (const state of this.queues.values()) {
      if (state.timer) {
        clearTimeout(state.timer);
      }
      this.notifyWaiters(state);
    }
  }

  async subscribe(queueName: string, listener: (event: QueueEvent) => void): Promise<() => void> {
    const bus = this.getEventBus(queueName);
    const handlers = new Map<string, (payload: unknown) => void>();

    for (const event of [
      "waiting",
      "active",
      "completed",
      "failed",
      "progress",
      "stalled",
      "drained",
    ]) {
      const handler = (payload: unknown) =>
        listener({
          event: event as QueueEvent["event"],
          payload: (payload as Record<string, unknown>) ?? {},
        });
      handlers.set(event, handler);
      bus.on(event, handler);
    }

    return () => {
      for (const [event, handler] of handlers) {
        bus.off(event, handler);
      }
    };
  }

  private getState(queueName: string): MemoryQueueState {
    let state = this.queues.get(queueName);
    if (!state) {
      state = {
        jobs: new Map(),
        waiting: createDeque(),
        pausedJobs: createDeque(),
        delayed: [],
        paused: false,
        waiters: new Set(),
      };
      this.queues.set(queueName, state);
    }
    return state;
  }

  private getEventBus(queueName: string): EventEmitter {
    return getMqEventBus(queueName);
  }

  private emitEvent(queueName: string, event: QueueEvent): void {
    this.getEventBus(queueName).emit(event.event, event.payload);
  }

  private notifyWaiters(state: MemoryQueueState): void {
    for (const waiter of state.waiters) {
      waiter();
    }
    state.waiters.clear();
  }

  private scheduleDelayed(queueName: string, state: MemoryQueueState): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    const next = heapPeek(state.delayed);
    if (!next) return;

    state.timer = setTimeout(
      () => {
        this.promoteDelayed(queueName, state);
      },
      Math.max(0, next.dueAt - Date.now()),
    );
  }

  private promoteDelayed(queueName: string, state: MemoryQueueState): void {
    const now = Date.now();
    let moved = false;

    while (true) {
      const next = heapPeek(state.delayed);
      if (!next || next.dueAt > now) break;

      heapPop(state.delayed);
      const job = state.jobs.get(next.jobId);
      if (!job || job.state !== "delayed") continue;

      job.delayUntil = undefined;
      job.state = state.paused ? "paused" : "waiting";
      if (state.paused) {
        enqueue(state.pausedJobs, job.id);
      } else {
        enqueue(state.waiting, job.id);
        this.emitEvent(queueName, { event: "waiting", payload: { jobId: job.id } });
      }
      moved = true;
    }

    this.scheduleDelayed(queueName, state);
    if (moved) {
      this.notifyWaiters(state);
    }
  }
}
