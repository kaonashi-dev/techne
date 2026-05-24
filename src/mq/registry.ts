import {
  MQ_ON_FAILURE_METADATA,
  MQ_PROCESSOR_METADATA,
  MQ_PROCESS_METADATA,
} from "../common/constants";
import type { Container } from "../core/container";
import { isCustomProvider } from "../core/container";
import { getBatchStore } from "./batch-context";
import { fireBatchCallbacks } from "./batch";
import {
  isDispatchableClass,
  type DispatchableConstructor,
} from "./dispatchable";
import type { Job } from "./job";
import { registerSyncHandler } from "./pending-dispatch";
import { Queue } from "./queue";
import { getMqToken } from "./tokens";
import type { MqProcessorMetadata, ProcessMetadata, QueueDriver } from "./types";
import { Worker } from "./worker";

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
    // Collect @OnFailure job names per queue from Processor classes so we can
    // validate against Dispatchable.failed() during the Dispatchable scan.
    const processorFailureJobsByQueue = new Map<string, Set<string>>();

    for (const provider of classes) {
      if (isCustomProvider(provider)) continue;
      const processor = Reflect.getMetadata(MQ_PROCESSOR_METADATA, provider) as
        | MqProcessorMetadata
        | undefined;
      if (!processor) continue;
      if (!this.container.isStatic(provider)) continue;

      const processMetadata = (Reflect.getMetadata(MQ_PROCESS_METADATA, provider) ||
        {}) as ProcessMetadata;
      const failureMetadata = (Reflect.getMetadata(MQ_ON_FAILURE_METADATA, provider) ||
        {}) as Record<string, string>;
      const instance = this.container.get<any>(provider);
      const queue = this.container.get<Queue>(getMqToken(processor.queueName));

      // Track @OnFailure-covered job names for this queue.
      const coveredJobs = processorFailureJobsByQueue.get(processor.queueName) ?? new Set<string>();
      for (const jobName of Object.values(failureMetadata)) {
        coveredJobs.add(jobName);
      }
      processorFailureJobsByQueue.set(processor.queueName, coveredJobs);

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

      this.attachBatchListeners(worker);

      worker.on("failed", async (job: Job, err: Error) => {
        if (job.state !== "failed") return;
        const methodName = this.findFailureHandler(failureMetadata, job.name);
        if (!methodName || typeof instance[methodName] !== "function") return;
        try {
          await instance[methodName](job.data, err);
        } catch (handlerErr) {
          console.error(
            `[MqRegistry] @OnFailure handler '${methodName}' threw for job '${job.name}':`,
            handlerErr,
          );
        }
      });

      this.workers.push(worker);
      void worker.run();
    }

    this.registerDispatchables(classes, processorFailureJobsByQueue);
  }

  private registerDispatchables(
    classes: any[],
    processorFailureJobsByQueue: Map<string, Set<string>>,
  ): void {
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

      // Duplicate failure-handler guard: a Dispatchable with failed() AND an
      // @OnFailure decorator on a Processor class covering the same queue+job.
      const processorCovered = processorFailureJobsByQueue.get(queueName);
      if (processorCovered) {
        for (const [jobName, cls] of table) {
          const hasFailedMethod = typeof (cls.prototype as any).failed === "function";
          if (hasFailedMethod && processorCovered.has(jobName)) {
            throw new Error(
              `Duplicate failure handler for job '${jobName}' on queue '${queueName}'`,
            );
          }
        }
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
          const instance = this.container.get<{ handle: (p: unknown) => unknown }>(cls);
          return await instance.handle(job.data);
        },
        { ...workerOptions, autorun: false },
      );

      this.attachBatchListeners(worker);

      worker.on("failed", async (job: Job, err: Error) => {
        if (job.state !== "failed") return;
        const cls = table.get(job.name);
        if (!cls) return;
        const hasFailedMethod = typeof (cls.prototype as any).failed === "function";
        if (!hasFailedMethod) return;
        const instance = this.container.get<any>(cls);
        try {
          await instance.failed(job.data, err);
        } catch (handlerErr) {
          console.error(
            `[MqRegistry] Dispatchable.failed() threw for job '${job.name}':`,
            handlerErr,
          );
        }
      });

      this.workers.push(worker);
      void worker.run();
    }
  }

  /**
   * Wire batch-barrier event listeners onto a worker. Both Processor and
   * Dispatchable workers get these so fan-out batches work regardless of
   * which job style is in use.
   *
   * On "active": check cancellation flag (best-effort).
   * On "completed": increment the completed counter; fire callbacks if done.
   * On "failed" (final): increment the failed counter; fire callbacks if done.
   */
  private attachBatchListeners(worker: Worker): void {
    worker.on("active", (job: Job) => {
      const batchId = job.opts.__batchId;
      if (!batchId) return;
      const store = getBatchStore();
      if (!store) return;
      // Note: we can't stop an already-claimed job. The cancelled flag is
      // available via BatchHandle.progress() for callers who want to abort work.
      void store.isCancelled(batchId);
    });

    worker.on("completed", (job: Job) => {
      const batchId = job.opts.__batchId;
      if (!batchId) return;
      const store = getBatchStore();
      if (!store) return;
      void (async () => {
        const { completed, failed, total } = await store.incrementCompleted(batchId);
        if (completed + failed === total) {
          await fireBatchCallbacks(batchId, store, failed);
        }
      })();
    });

    worker.on("failed", (job: Job) => {
      const batchId = job.opts.__batchId;
      if (!batchId) return;
      if (job.state !== "failed") return; // retry still pending
      const store = getBatchStore();
      if (!store) return;
      void (async () => {
        const { completed, failed, total } = await store.incrementFailed(batchId);
        if (completed + failed === total) {
          await fireBatchCallbacks(batchId, store, failed);
        }
      })();
    });
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

  private findFailureHandler(
    failureMetadata: Record<string, string>,
    jobName: string,
  ): string | undefined {
    for (const [methodName, registeredJobName] of Object.entries(failureMetadata)) {
      if (registeredJobName === jobName) return methodName;
    }
    return undefined;
  }
}
