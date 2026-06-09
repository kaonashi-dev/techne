/**
 * Tests for Phase 5: queue/MQ payload validation.
 *
 * Covers:
 * - Valid dispatch-time validation passes
 * - Invalid dispatch-time payload throws synchronously with property-level errors
 * - validate: "consume" — bad payload dispatches fine, worker triggers @OnFailure
 * - validate: "both" — fails at dispatch AND at consume
 * - No validate option — back-compat passthrough (no validation)
 * - Raw TypeBox TSchema validation
 * - Schemas key not in jobs → TypeError at defineQueue time
 * - Schema for one job validates only that job; others are unvalidated
 */
import "../src/reflect-setup";
import { afterEach, describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  Queueable,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  mq,
  On,
  OnFailure,
  Processor,
  type Job,
} from "../src/mq";
import { QueuePayloadValidationError } from "../src/mq/errors";
import { Dto, IsString, IsNumber, IsOptional, MinLength } from "../src/schema";

// ── Test DTO ──────────────────────────────────────────────────────────────────

@Dto()
class InitiateTaskDto {
  @IsString()
  @MinLength(1)
  taskId!: string;

  @IsOptional()
  @IsNumber()
  priority?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Queue payload validation", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
  });

  // ── Back-compat: no validation option ──────────────────────────────────────

  test("no validate option — invalid payload passes without error (back-compat)", async () => {
    const Q = defineQueue({
      name: "pv-novalidate",
      jobs: { "initiate-task": {} as { taskId: string } },
      schemas: {
        "initiate-task": InitiateTaskDto,
      },
      // No validate option → no-op
    });

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Should not throw even with invalid payload — no validate option means no-op
    await Q.dispatchers["initiate-task"]({ taskId: "" });
    // No assertion needed: reaching here means no error was thrown
  });

  // ── Dispatch-time validation ───────────────────────────────────────────────

  test("validate: 'dispatch' — valid payload succeeds", async () => {
    const Q = defineQueue(
      {
        name: "pv-dispatch-valid",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
      },
      { validate: "dispatch" },
    );

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Should not throw for valid payload
    await Q.dispatchers["initiate-task"]({ taskId: "task-1" });
    // Reaching here means success
  });

  test("validate: 'dispatch' — invalid payload throws synchronously", () => {
    const Q = defineQueue(
      {
        name: "pv-dispatch-invalid",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
      },
      { validate: "dispatch" },
    );

    // Missing required taskId — should throw immediately (synchronously)
    expect(() => Q.dispatchers["initiate-task"]({ taskId: "" })).toThrow(
      QueuePayloadValidationError,
    );
  });

  test("validate: 'dispatch' — error includes queue and job names", () => {
    const Q = defineQueue(
      {
        name: "pv-dispatch-errmsg",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
      },
      { validate: "dispatch" },
    );

    let caught: QueuePayloadValidationError | undefined;
    try {
      Q.dispatchers["initiate-task"]({ taskId: "" });
    } catch (e) {
      caught = e as QueuePayloadValidationError;
    }

    expect(caught).toBeInstanceOf(QueuePayloadValidationError);
    expect(caught!.queueName).toBe("pv-dispatch-errmsg");
    expect(caught!.jobName).toBe("initiate-task");
    expect(caught!.errors.length).toBeGreaterThan(0);
    expect(caught!.message).toContain("pv-dispatch-errmsg/initiate-task");
  });

  // ── Raw TypeBox TSchema ────────────────────────────────────────────────────

  test("validate: 'dispatch' with raw TypeBox TSchema", () => {
    const rawSchema = Type.Object({
      taskId: Type.String({ minLength: 1 }),
    });

    const Q = defineQueue(
      {
        name: "pv-raw-schema",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": rawSchema },
      },
      { validate: "dispatch" },
    );

    // Valid
    expect(() => Q.dispatchers["initiate-task"]({ taskId: "abc" })).not.toThrow();

    // Invalid
    expect(() => Q.dispatchers["initiate-task"]({ taskId: "" })).toThrow(
      QueuePayloadValidationError,
    );
  });

  // ── Consume-time validation ────────────────────────────────────────────────

  test("validate: 'consume' — bad payload dispatches ok, worker triggers @OnFailure", async () => {
    const Q = defineQueue(
      {
        name: "pv-consume",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
        worker: { blockTimeout: 10, lockDuration: 200 },
      },
      { validate: "consume" },
    );

    const failedPayloads: unknown[] = [];
    const failedErrors: Error[] = [];

    @Processor(Q, { blockTimeout: 10, lockDuration: 200 })
    class TaskProcessor {
      @On("initiate-task")
      handle(_job: Job) {
        // Should not reach here
      }

      @OnFailure("initiate-task")
      onFailed(payload: unknown, err: Error) {
        failedPayloads.push(payload);
        failedErrors.push(err);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [TaskProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Dispatch with bad payload — should NOT throw at dispatch time
    const queue = ctx.get<any>(`Mq_${Q.name}`);
    await queue.add("initiate-task", { taskId: "" }, { attempts: 1 });

    await sleep(300);

    // @OnFailure should have been triggered
    expect(failedErrors).toHaveLength(1);
    expect(failedErrors[0]).toBeInstanceOf(QueuePayloadValidationError);
    expect((failedErrors[0] as QueuePayloadValidationError).jobName).toBe("initiate-task");
  });

  test("validate: 'consume' — Dispatchable.failed() is triggered on bad consume payload", async () => {
    const Q = defineQueue(
      {
        name: "pv-consume-dispatchable",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
        worker: { blockTimeout: 10, lockDuration: 200 },
      },
      { validate: "consume" },
    );

    const failedErrors: Error[] = [];

    @Queueable()
    class InitiateTaskJob extends Dispatchable<{ taskId: string }> {
      static override queue = Q;
      static override jobName = "initiate-task";

      async handle() {
        // Should not reach here with invalid payload
      }

      async failed(_payload: unknown, err: Error) {
        failedErrors.push(err);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [InitiateTaskJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Enqueue with invalid payload directly (bypass dispatch validation)
    const queue = ctx.get<any>(`Mq_${Q.name}`);
    await queue.add("initiate-task", { taskId: "" }, { attempts: 1 });

    await sleep(300);

    expect(failedErrors).toHaveLength(1);
    expect(failedErrors[0]).toBeInstanceOf(QueuePayloadValidationError);
  });

  // ── validate: "both" ──────────────────────────────────────────────────────

  test("validate: 'both' — invalid payload throws at dispatch time", () => {
    const Q = defineQueue(
      {
        name: "pv-both-dispatch",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
      },
      { validate: "both" },
    );

    expect(() => Q.dispatchers["initiate-task"]({ taskId: "" })).toThrow(
      QueuePayloadValidationError,
    );
  });

  test("validate: 'both' — valid dispatch, then consume validation runs too", async () => {
    const Q = defineQueue(
      {
        name: "pv-both-consume",
        jobs: { "initiate-task": {} as { taskId: string } },
        schemas: { "initiate-task": InitiateTaskDto },
        worker: { blockTimeout: 10, lockDuration: 200 },
      },
      { validate: "both" },
    );

    const handled: string[] = [];
    const failedErrors: Error[] = [];

    @Processor(Q, { blockTimeout: 10, lockDuration: 200 })
    class TaskProcessor {
      @On("initiate-task")
      handle(job: Job<{ taskId: string }>) {
        handled.push(job.data.taskId);
      }

      @OnFailure("initiate-task")
      onFailed(_payload: unknown, err: Error) {
        failedErrors.push(err);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [TaskProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Valid payload should pass dispatch AND consume
    await Q.dispatchers["initiate-task"]({ taskId: "task-99" });

    await sleep(300);

    expect(handled).toEqual(["task-99"]);
    expect(failedErrors).toHaveLength(0);
  });

  // ── Partial schemas (only some jobs validated) ────────────────────────────

  test("schema for one job validates only that job; other jobs run unvalidated", async () => {
    const Q = defineQueue(
      {
        name: "pv-partial",
        jobs: {
          validated: {} as { taskId: string },
          unvalidated: {} as { anything: unknown },
        },
        schemas: { validated: InitiateTaskDto },
      },
      { validate: "dispatch" },
    );

    // Validated job with bad payload → throws
    expect(() => Q.dispatchers.validated({ taskId: "" })).toThrow(QueuePayloadValidationError);

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Unvalidated job with anything → passes without error
    await Q.dispatchers.unvalidated({ anything: null });
    // Reaching here means success
  });

  // ── Boot-time safety check ────────────────────────────────────────────────

  test("schemas key not in jobs → TypeError at defineQueue time", () => {
    expect(() =>
      defineQueue(
        {
          name: "pv-boot-check",
          jobs: { "initiate-task": {} as { taskId: string } },
          schemas: { "non-existent-job": InitiateTaskDto } as any,
        },
        { validate: "dispatch" },
      ),
    ).toThrow(TypeError);

    expect(() =>
      defineQueue(
        {
          name: "pv-boot-check-2",
          jobs: { "initiate-task": {} as { taskId: string } },
          schemas: { "non-existent-job": InitiateTaskDto } as any,
        },
        { validate: "dispatch" },
      ),
    ).toThrow(/non-existent-job/);
  });
});
