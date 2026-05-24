import { afterEach, describe, expect, test } from "bun:test";
import { Injectable } from "../src/common";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Dispatchable,
  Queueable,
  PendingDispatch,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  dispatchToQueue,
  getDispatcherContext,
  mq,
  setDispatcherContext,
  withDispatcherContext,
  type QueueResolver,
} from "../src/mq";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("mq dispatch (Laravel-style)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
  });

  test("PendingDispatch enqueues on await via the active resolver", async () => {
    const Payins = defineQueue({
      name: "dispatch-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
    });

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Payins] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    await Payins.dispatchers.initiatePayin({ payinId: "pi_1" })
      .delay(0)
      .tries(2);

    const queue = ctx.get<any>(`Mq_${Payins.name}`);
    expect(await queue.getJobCounts("waiting")).toEqual({ waiting: 1 });
  });

  test("getDispatcherContext throws before mq() bootstraps", () => {
    expect(() => getDispatcherContext()).toThrow(/No dispatcher context/);
  });

  test("withDispatcherContext temporarily installs a resolver", async () => {
    const Payins = defineQueue({
      name: "withctx-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
    });

    const captured: Array<{ name: string; payload: unknown }> = [];
    const fake: QueueResolver = (queueName) => {
      return {
        add: async (jobName: string, payload: unknown) => {
          captured.push({ name: `${queueName}::${jobName}`, payload });
          return { id: "fake" };
        },
      } as any;
    };

    await withDispatcherContext(fake, async () => {
      await Payins.dispatchers.initiatePayin({ payinId: "pi_42" });
    });

    expect(captured).toEqual([
      { name: "withctx-payins::initiatePayin", payload: { payinId: "pi_42" } },
    ]);
    expect(() => getDispatcherContext()).toThrow(/No dispatcher context/);
  });

  test("dispatchIf / dispatchUnless skip enqueue when the condition fails", async () => {
    const Payins = defineQueue({
      name: "cond-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
    });

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Payins] })],
      logger: false,
    });
    closers.push(() => ctx.close());

    await Payins.dispatchers.initiatePayin({ payinId: "skip" }).dispatchIf(false);
    await Payins.dispatchers.initiatePayin({ payinId: "skip" }).dispatchUnless(true);
    await Payins.dispatchers.initiatePayin({ payinId: "run" }).dispatchIf(true);

    const queue = ctx.get<any>(`Mq_${Payins.name}`);
    expect(await queue.getJobCounts("waiting")).toEqual({ waiting: 1 });
  });

  test("Dispatchable subclass dispatches and is auto-discovered as a handler", async () => {
    const Payins = defineQueue({
      name: "dispatchable-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const seen: string[] = [];

    @Injectable()
    class Tracker {
      record(id: string) {
        seen.push(id);
      }
    }

    @Queueable()
    class InitiatePayin extends Dispatchable<{ payinId: string }> {
      static override queue = Payins;
      static override jobName = "initiatePayin";
      constructor(private readonly tracker: Tracker) {
        super();
      }
      async handle({ payinId }: { payinId: string }) {
        this.tracker.record(payinId);
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Payins] })],
      providers: [Tracker, InitiatePayin],
      logger: false,
    });
    closers.push(() => ctx.close());

    await InitiatePayin.dispatch({ payinId: "pi_99" });
    await sleep(60);

    expect(seen).toEqual(["pi_99"]);
  });

  test("Dispatchable.dispatchSync runs the handler inline without touching the queue", async () => {
    const Payins = defineQueue({
      name: "sync-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
      worker: { blockTimeout: 10, lockDuration: 200 },
    });

    const seen: string[] = [];

    @Injectable()
    class Tracker {
      record(id: string) {
        seen.push(id);
      }
    }

    @Queueable()
    class InitiatePayin extends Dispatchable<{ payinId: string }, string> {
      static override queue = Payins;
      static override jobName = "initiatePayin";
      constructor(private readonly tracker: Tracker) {
        super();
      }
      async handle({ payinId }: { payinId: string }) {
        this.tracker.record(payinId);
        return `ack:${payinId}`;
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Payins] })],
      providers: [Tracker, InitiatePayin],
      logger: false,
    });
    closers.push(() => ctx.close());

    const result = await InitiatePayin.dispatchSync({ payinId: "pi_inline" });

    expect(result).toBe("ack:pi_inline");
    expect(seen).toEqual(["pi_inline"]);
    const queue = ctx.get<any>(`Mq_${Payins.name}`);
    expect(await queue.getJobCounts("waiting")).toEqual({ waiting: 0 });
  });

  test("Dispatchable.dispatch fails fast if static queue is missing", () => {
    class Orphan extends Dispatchable<{ id: string }> {
      async handle() {}
    }
    expect(() => Orphan.dispatch({ id: "x" })).toThrow(/missing 'static queue'/);
  });

  test("registry throws when two Dispatchables claim the same job name", async () => {
    const Payins = defineQueue({
      name: "dup-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
    });

    @Queueable()
    class A extends Dispatchable<{ payinId: string }> {
      static override queue = Payins;
      static override jobName = "initiatePayin";
      async handle() {}
    }
    @Queueable()
    class B extends Dispatchable<{ payinId: string }> {
      static override queue = Payins;
      static override jobName = "initiatePayin";
      async handle() {}
    }

    await expect(
      TechneFactory.createApplicationContext({
        plugins: [mq({ queues: [Payins] })],
        providers: [A, B],
        logger: false,
      }),
    ).rejects.toThrow(/Two Dispatchable classes claim job 'initiatePayin'/);
  });

  test("dispatchToQueue is the shared core for both dispatch paths", async () => {
    const Payins = defineQueue({
      name: "core-payins",
      jobs: { initiatePayin: {} as { payinId: string } },
    });

    const captured: Array<{ q: string; n: string; data: unknown }> = [];
    setDispatcherContext((queueName) => {
      return {
        add: async (jobName: string, payload: unknown) => {
          captured.push({ q: queueName, n: jobName, data: payload });
          return { id: "noop" };
        },
      } as any;
    });

    await dispatchToQueue(Payins.name, "initiatePayin", { payinId: "x" });

    expect(captured).toEqual([
      { q: "core-payins", n: "initiatePayin", data: { payinId: "x" } },
    ]);
  });

  test("PendingDispatch is exported and instanceable", () => {
    expect(typeof PendingDispatch).toBe("function");
  });
});
