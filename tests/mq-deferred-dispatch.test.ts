import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  Dispatchable,
  getDeferredBuffer,
  mq,
  Queueable,
} from "../src/mq";

// Helper: wait a few microtasks so `onAfterResponse` hooks settle.
const tick = (ms = 20) => new Promise<void>((r) => setTimeout(r, ms));

describe("mq deferred dispatch (dispatchAfterResponse)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
  });

  // ── 1. Inside HTTP: jobs enqueue AFTER the response ──────────────────────────

  test("dispatchAfterResponse enqueues after the HTTP response is sent", async () => {
    const Jobs = defineQueue({
      name: "deferred-basic",
      jobs: { send: {} as { id: string } },
    });

    const enqueueOrder: string[] = [];

    @Controller("deferred-basic")
    class TestController {
      @Get("/")
      handle() {
        enqueueOrder.push("response-body");
        Jobs.dispatchers.send({ id: "j1" }).afterResponse();
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [TestController],
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => app.close());

    // Intercept queue.add so we can track call order without a real driver.
    const queue = app.get<any>(`Mq_${Jobs.name}`);
    const addSpy = spyOn(queue, "add").mockImplementation(async (...args: any[]) => {
      enqueueOrder.push(`enqueue:${args[1]?.id}`);
      return { id: "fake" };
    });

    const response = await app.handle(new Request("http://localhost/deferred-basic"));
    expect(response.status).toBe(200);

    // At this point the response is resolved but onAfterResponse may still
    // be in-flight. The body was returned before the enqueue.
    const bodyBeforeFlush = enqueueOrder[0];
    expect(bodyBeforeFlush).toBe("response-body");

    // Give onAfterResponse time to flush.
    await tick();

    expect(enqueueOrder).toEqual(["response-body", "enqueue:j1"]);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  // ── 2. Outside HTTP: falls back to immediate fire-and-forget ─────────────────

  test("dispatchAfterResponse outside HTTP dispatches immediately (fire-and-forget)", async () => {
    const Jobs = defineQueue({
      name: "deferred-fallback",
      jobs: { run: {} as { id: string } },
    });

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    // Confirm we are outside an HTTP context (no deferred buffer).
    expect(getDeferredBuffer()).toBeUndefined();

    // Call Dispatchable.dispatchAfterResponse — should fire immediately.
    @Queueable()
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Jobs;
      static override jobName = "run";
      async handle() {}
    }
    ctx.get(RunJob); // register

    RunJob.dispatchAfterResponse({ id: "fallback" });

    // Give the fire-and-forget a tick to complete.
    await tick();

    const queue = ctx.get<any>(`Mq_${Jobs.name}`);
    const counts = await queue.getJobCounts("waiting");
    expect(counts.waiting).toBe(1);
  });

  // ── 3. Multiple deferred dispatches flush in order ───────────────────────────

  test("multiple dispatchAfterResponse calls flush in order", async () => {
    const Jobs = defineQueue({
      name: "deferred-multi",
      jobs: { task: {} as { seq: number } },
    });

    const flushed: number[] = [];

    @Controller("deferred-multi")
    class MultiController {
      @Get("/")
      handle() {
        Jobs.dispatchers.task({ seq: 1 }).afterResponse();
        Jobs.dispatchers.task({ seq: 2 }).afterResponse();
        Jobs.dispatchers.task({ seq: 3 }).afterResponse();
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [MultiController],
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => app.close());

    const queue = app.get<any>(`Mq_${Jobs.name}`);
    spyOn(queue, "add").mockImplementation(async (_name: string, payload: any) => {
      flushed.push(payload.seq);
      return { id: "fake" };
    });

    const response = await app.handle(new Request("http://localhost/deferred-multi"));
    expect(response.status).toBe(200);
    await tick();

    expect(flushed).toEqual([1, 2, 3]);
  });

  // ── 4. Flush errors are logged, response is unaffected ───────────────────────

  test("deferred dispatch error is logged and does not affect the HTTP response", async () => {
    const Jobs = defineQueue({
      name: "deferred-error",
      jobs: { fail: {} as { id: string } },
    });

    @Controller("deferred-error")
    class ErrorController {
      @Get("/")
      handle() {
        Jobs.dispatchers.fail({ id: "boom" }).afterResponse();
        return { status: "ok" };
      }
    }

    const app = await TechneFactory.create({
      controllers: [ErrorController],
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => app.close());

    const queue = app.get<any>(`Mq_${Jobs.name}`);
    spyOn(queue, "add").mockImplementation(async () => {
      throw new Error("driver exploded");
    });

    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await app.handle(new Request("http://localhost/deferred-error"));
      // Response should be 200 regardless of the flush error.
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "ok" });

      // Wait for the flush (which will throw).
      await tick();

      expect(errorSpy).toHaveBeenCalledWith("[mq] deferred dispatch error", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  // ── 5. PendingDispatch.afterResponse() defers correctly ──────────────────────

  test("PendingDispatch.afterResponse() works like dispatchAfterResponse", async () => {
    const Jobs = defineQueue({
      name: "deferred-pending",
      jobs: { notify: {} as { userId: string } },
    });

    const dispatched: string[] = [];

    @Controller("deferred-pending")
    class PendingController {
      @Get("/")
      handle() {
        // Using the builder form — can set options before deferring.
        Jobs.dispatchers.notify({ userId: "u1" }).delay(0).afterResponse();
        return { sent: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [PendingController],
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => app.close());

    const queue = app.get<any>(`Mq_${Jobs.name}`);
    spyOn(queue, "add").mockImplementation(async (_name: string, payload: any) => {
      dispatched.push(payload.userId);
      return { id: "fake" };
    });

    const response = await app.handle(new Request("http://localhost/deferred-pending"));
    expect(response.status).toBe(200);

    // Give onAfterResponse time to complete its flush.
    await tick();
    expect(dispatched).toEqual(["u1"]);
  });

  // ── 6. Dispatchable.dispatchAfterResponse static shorthand ───────────────────

  test("Dispatchable.dispatchAfterResponse static method defers inside HTTP", async () => {
    const Jobs = defineQueue({
      name: "deferred-static",
      jobs: { process: {} as { ref: string } },
    });

    const dispatched: string[] = [];

    @Queueable()
    class ProcessJob extends Dispatchable<{ ref: string }> {
      static override queue = Jobs;
      static override jobName = "process";
      async handle() {}
    }

    @Controller("deferred-static")
    class StaticController {
      @Get("/")
      handle() {
        ProcessJob.dispatchAfterResponse({ ref: "abc" });
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [StaticController],
      providers: [ProcessJob],
      plugins: [mq({ queues: [Jobs] })],
      logger: false,
    });
    closers.push(() => app.close());

    const queue = app.get<any>(`Mq_${Jobs.name}`);
    spyOn(queue, "add").mockImplementation(async (_name: string, payload: any) => {
      dispatched.push(payload.ref);
      return { id: "fake" };
    });

    const response = await app.handle(new Request("http://localhost/deferred-static"));
    expect(response.status).toBe(200);

    // Give onAfterResponse time to complete its flush.
    await tick();
    expect(dispatched).toEqual(["abc"]);
  });
});
