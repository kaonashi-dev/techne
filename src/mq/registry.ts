import { MQ_PROCESSOR_METADATA, MQ_PROCESS_METADATA } from "../common/constants";
import type { Container } from "../core/container";
import { isCustomProvider } from "../core/container";
import { getChainStore } from "./chain-context";
import {
  isDispatchableClass,
  type DispatchableConstructor,
  type Dispatchable,
} from "./dispatchable";
import { dispatchToQueue } from "./dispatcher";
import { JobReleasedError } from "./errors";
import type { Job } from "./job";
import { registerSyncHandler } from "./pending-dispatch";
import { Queue } from "./queue";
import { getMqToken } from "./tokens";
import type { JobMiddleware, MqProcessorMetadata, ProcessMetadata, QueueDriver } from "./types";
import { Worker } from "./worker";

/**
 * Compose a left-to-right middleware stack around `handler`. The first
 * middleware in the array is the outermost wrapper (runs first before the
 * handler, last on the way back out).
 */
function buildMiddlewareStack(
  middlewares: JobMiddleware[],
  job: Job,
  handler: () => Promise<unknown>,
): () => Promise<unknown> {
  return middlewares.reduceRight(
    (next, mw) => () => mw.handle(job, next),
    handler,
  );
}

export class MqRegistry {
  private workers: Worker[] = [];

  constructor(
    private readonly container: Container,
    private readonly driver: QueueDriver,
  ) {}

  register(containerToken?: boolean): void {
    if (containerToken === false) return;
    this.container.set(MqRegistry, this);
  }

  registerFromClasses(classes: any[]): void {
    for (const provider of classes) {
      if (isCustomProvider(provider)) continue;
      const processor = Reflect.getMetadata(MQ_PROCESSOR_METADATA, provider) as
        | MqProcessorMetadata
        | undefined;
      if (!processor) continue;
      if (!this.container.isStatic(provider)) continue;

      const processMetadata = (Reflect.getMetadata(MQ_PROCESS_METADATA, provider) ||
        {}) as ProcessMetadata;
      const instance = this.container.get<any>(provider);
      const queue = this.container.get<Queue>(getMqToken(processor.queueName));

      const worker = new Worker(
        queue,
        async (job) => {
          const handlerName =
            this.findHandler(processMetadata, job.name) ??
            this.findHandler(processMetadata) ??
            (typeof instance.handle === "function" ? "handle" : undefined);
          if (!handlerName || typeof instance[handlerName] !== "function") {
            throw new Error(
              `No processor handler found for job '${job.name}' in queue '${processor.queueName}'`,
            );
          }
          return await instance[handlerName](job);
        },
        {
          ...processor.options,
          autorun: false,
        },
      );

      this.attachChainListeners(worker);

      this.workers.push(worker);
      void worker.run();
    }

    this.registerDispatchables(classes);
  }

  private registerDispatchables(classes: any[]): void {
    const byQueue = new Map<string, DispatchableConstructor<unknown, unknown>[]>();
    for (const provider of classes) {
      if (isCustomProvider(provider)) continue;
      if (!isDispatchableClass(provider)) continue;
      if (!this.container.isStatic(provider)) continue;
      if (!provider.queue) {
        throw new TypeError(
          `Dispatchable '${provider.name}' is missing 'static queue' — set it to a QueueDef.`,
        );
      }
      const list = byQueue.get(provider.queue.name) ?? [];
      list.push(provider);
      byQueue.set(provider.queue.name, list);
    }

    for (const [queueName, dispatchables] of byQueue) {
      const table = new Map<string, DispatchableConstructor<unknown, unknown>>();
      for (const cls of dispatchables) {
        const jobName = cls.jobName ?? cls.name;
        if (table.has(jobName)) {
          throw new Error(
            `Two Dispatchable classes claim job '${jobName}' on queue '${queueName}': ` +
              `'${table.get(jobName)?.name}' and '${cls.name}'`,
          );
        }
        table.set(jobName, cls);
        registerSyncHandler(queueName, jobName, async (payload) => {
          const instance = this.container.get<{ handle: (p: unknown) => unknown }>(cls);
          return await instance.handle(payload);
        });
      }

      const queue = this.container.get<Queue>(getMqToken(queueName));
      const workerOptions = dispatchables[0]?.queue.workerOptions ?? {};
      const worker = new Worker(
        queue,
        async (job) => {
          const cls = table.get(job.name);
          if (!cls) {
            throw new Error(
              `No Dispatchable registered for job '${job.name}' on queue '${queueName}'`,
            );
          }
          // Release the unique lock immediately if this is a @UniqueUntilProcessing job.
          if (job.opts.lockUntilProcessing && job.opts.lockKey) {
            await this.releaseLock(job.opts.lockKey);
          }
          const instance = this.container.get<Dispatchable<unknown, unknown>>(cls);
          const middlewares = instance.middleware?.() ?? [];
          const runner = buildMiddlewareStack(middlewares, job, () =>
            Promise.resolve((instance as { handle: (p: unknown) => unknown }).handle(job.data)),
          );
          try {
            return await runner();
          } catch (err) {
            if (err instanceof JobReleasedError) {
              // Re-enqueue with delay; complete this attempt cleanly without
              // incrementing the failure counter.
              await dispatchToQueue(queueName, job.name, job.data as unknown, {
                ...job.opts,
                delay: err.delayMs,
              });
              return undefined;
            }
            throw err;
          }
        },
        { ...workerOptions, autorun: false },
      );

      this.attachChainListeners(worker);

      // Release the @Unique lock when the job reaches a terminal state.
      worker.on("completed", (job: Job) => {
        if (job.opts.lockKey && !job.opts.lockUntilProcessing) {
          void this.releaseLock(job.opts.lockKey);
        }
      });

      worker.on("failed", async (job: Job) => {
        if (job.state !== "failed") return;
        // Release the @Unique lock on final failure (not retries).
        if (job.opts.lockKey && !job.opts.lockUntilProcessing) {
          await this.releaseLock(job.opts.lockKey);
        }
      });

      this.workers.push(worker);
      void worker.run();
    }
  }

  /**
   * Wire chain-advancement event listeners onto a worker. Called for both
   * Processor workers and Dispatchable workers so chains work across both
   * job styles.
   *
   * On "completed": advance to the next step.
   * On "failed" (final): dispatch the catch handler if present, then cleanup.
   */
  private attachChainListeners(worker: Worker): void {
    worker.on("completed", (job: Job) => {
      const chainId = job.opts.__chainId;
      if (!chainId) return;
      const store = getChainStore();
      if (!store) return;
      void (async () => {
        const next = await store.next(chainId);
        if (!next) {
          await store.cleanup(chainId);
          return;
        }
        await dispatchToQueue(next.queueName, next.jobName, next.payload, {
          ...next.options,
          __chainId: chainId,
          __chainStepIndex: (job.opts.__chainStepIndex ?? 0) + 1,
        });
      })();
    });

    worker.on("failed", (job: Job) => {
      const chainId = job.opts.__chainId;
      if (!chainId) return;
      if (job.state !== "failed") return; // not final failure — retry pending
      const store = getChainStore();
      if (!store) return;
      void (async () => {
        const catchSpec = await store.catch(chainId);
        await store.cleanup(chainId);
        if (catchSpec) {
          try {
            await dispatchToQueue(
              catchSpec.queueName,
              catchSpec.jobName,
              catchSpec.payload,
              catchSpec.options,
            );
          } catch (err) {
            console.error(`[MqRegistry] Chain catch handler dispatch failed for chain '${chainId}':`, err);
          }
        }
      })();
    });
  }

  private async releaseLock(lockKey: string): Promise<void> {
    try {
      await this.driver.releaseUniqueLock(lockKey);
    } catch (e) {
      console.error(`[MqRegistry] Failed to release unique lock '${lockKey}':`, e);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.workers.map((worker) => worker.close()));
    await this.driver.close();
  }

  private findHandler(processMetadata: ProcessMetadata, jobName?: string): string | undefined {
    for (const [methodName, registeredJobName] of Object.entries(processMetadata)) {
      if (registeredJobName === jobName) return methodName;
    }
    if (jobName !== undefined) return undefined;
    return Object.entries(processMetadata).find(
      ([, registeredJobName]) => registeredJobName === undefined,
    )?.[0];
  }
}
