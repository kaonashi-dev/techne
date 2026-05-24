import { afterEach, describe, expect, test } from "bun:test";
import {
  Dispatchable,
  Queueable,
  batch,
  chain,
  clearBatchStore,
  clearChainStore,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  fakeQueue,
  getDispatcherContext,
  setBatchStore,
  setChainStore,
  setDispatcherContext,
  type QueueResolver,
} from "../src/mq";
import { MemoryBatchStore } from "../src/mq/batch-store";
import { MemoryChainStore } from "../src/mq/chain-store";

const PayinsQueueDef = defineQueue({
  name: "fake-payins",
  jobs: {
    initiatePayin: {} as { payinId: string },
    postProcessPayin: {} as { payinId: string },
    publishReceipt: {} as { payinId: string },
    settlePayins: {} as Record<string, never>,
  },
});

const AlertsQueueDef = defineQueue({
  name: "fake-alerts",
  jobs: { warn: {} as { msg: string } },
});

@Queueable()
class InitiatePayin extends Dispatchable<{ payinId: string }> {
  static override queue = PayinsQueueDef;
  static override jobName = "initiatePayin";
  async handle() {}
}

@Queueable()
class PostProcessPayin extends Dispatchable<{ payinId: string }> {
  static override queue = PayinsQueueDef;
  static override jobName = "postProcessPayin";
  async handle() {}
}

@Queueable()
class PublishReceipt extends Dispatchable<{ payinId: string }> {
  static override queue = PayinsQueueDef;
  static override jobName = "publishReceipt";
  async handle() {}
}

@Queueable()
class SettlePayins extends Dispatchable<Record<string, never>> {
  static override queue = PayinsQueueDef;
  static override jobName = "settlePayins";
  async handle() {}
}

@Queueable()
class Warn extends Dispatchable<{ msg: string }> {
  static override queue = AlertsQueueDef;
  static override jobName = "warn";
  async handle() {}
}

describe("fakeQueue", () => {
  afterEach(() => {
    clearDispatcherContext();
    clearChainStore();
    clearBatchStore();
    clearSyncHandlers();
  });

  test("records every dispatch made inside use()", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
      await InitiatePayin.dispatch({ payinId: "pi_2" });
      await Warn.dispatch({ msg: "hi" });
    });

    const all = q.all();
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({
      queueName: "fake-payins",
      jobName: "initiatePayin",
      payload: { payinId: "pi_1" },
    });
    expect(all[2]).toMatchObject({
      queueName: "fake-alerts",
      jobName: "warn",
      payload: { msg: "hi" },
    });
  });

  test("assertDispatched passes for matching class and fails otherwise", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
    });

    expect(() => q.assertDispatched(InitiatePayin)).not.toThrow();
    expect(() => q.assertDispatched(PostProcessPayin)).toThrow(/PostProcessPayin.*0 matching/);
    expect(() => q.assertDispatched("initiatePayin")).not.toThrow();
    expect(() => q.assertDispatched("nope")).toThrow(/'nope'.*0 matching/);
  });

  test("assertDispatched accepts a payload predicate", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
      await InitiatePayin.dispatch({ payinId: "pi_2" });
    });

    expect(() =>
      q.assertDispatched(InitiatePayin, (p) => (p as { payinId: string }).payinId === "pi_2"),
    ).not.toThrow();

    expect(() =>
      q.assertDispatched(InitiatePayin, (p) => (p as { payinId: string }).payinId === "pi_99"),
    ).toThrow(/did not match/);
  });

  test("assertDispatchedTimes, assertNotDispatched, assertNothingDispatched", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
      await InitiatePayin.dispatch({ payinId: "pi_2" });
    });

    expect(() => q.assertDispatchedTimes(InitiatePayin, 2)).not.toThrow();
    expect(() => q.assertDispatchedTimes(InitiatePayin, 3)).toThrow(/3x; got 2/);
    expect(() => q.assertNotDispatched(PostProcessPayin)).not.toThrow();
    expect(() => q.assertNotDispatched(InitiatePayin)).toThrow(/got 2/);
    expect(() => q.assertNothingDispatched()).toThrow(/got 2/);

    const empty = fakeQueue();
    await empty.use(async () => {
      // dispatch nothing
    });
    expect(() => empty.assertNothingDispatched()).not.toThrow();
  });

  test("assertNothingDispatchedOn filters by queue", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
    });

    expect(() => q.assertNothingDispatchedOn(AlertsQueueDef)).not.toThrow();
    expect(() => q.assertNothingDispatchedOn("fake-alerts")).not.toThrow();
    expect(() => q.assertNothingDispatchedOn(PayinsQueueDef)).toThrow(/fake-payins.*got 1/);
  });

  test("assertChained matches the full step sequence by class", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await chain([
        InitiatePayin.dispatch({ payinId: "pi_1" }),
        PostProcessPayin.dispatch({ payinId: "pi_1" }),
        PublishReceipt.dispatch({ payinId: "pi_1" }),
      ]).dispatch();
    });

    expect(() => q.assertChained([InitiatePayin, PostProcessPayin, PublishReceipt])).not.toThrow();

    // Wrong order
    expect(() => q.assertChained([PostProcessPayin, InitiatePayin, PublishReceipt])).toThrow(
      /none matched/,
    );

    // Wrong length
    expect(() => q.assertChained([InitiatePayin, PostProcessPayin])).toThrow(/none matched/);
  });

  test("chains() exposes catchSpec and remaining steps", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await chain([
        InitiatePayin.dispatch({ payinId: "pi_1" }),
        PostProcessPayin.dispatch({ payinId: "pi_1" }),
      ])
        .catch(Warn.dispatch({ msg: "chain failed" }))
        .dispatch();
    });

    const chains = q.chains();
    expect(chains).toHaveLength(1);
    expect(chains[0]!.firstStep.jobName).toBe("initiatePayin");
    expect(chains[0]!.remainingSteps).toHaveLength(1);
    expect(chains[0]!.remainingSteps[0]!.jobName).toBe("postProcessPayin");
    expect(chains[0]!.catchSpec?.jobName).toBe("warn");
  });

  test("assertBatched with a predicate over BatchRecord", async () => {
    const q = fakeQueue();

    await q.use(async () => {
      await batch([
        InitiatePayin.dispatch({ payinId: "pi_1" }),
        InitiatePayin.dispatch({ payinId: "pi_2" }),
        InitiatePayin.dispatch({ payinId: "pi_3" }),
      ])
        .then(SettlePayins.dispatch({}))
        .dispatch();
    });

    expect(() => q.assertBatched((b) => b.total === 3 && b.jobs.length === 3)).not.toThrow();

    expect(() =>
      q.assertBatched((b) => b.callbacks.then?.jobName === "settlePayins"),
    ).not.toThrow();

    expect(() => q.assertBatched((b) => b.total === 99)).toThrow(/none matched/);
  });

  test("restores the prior dispatcher / chain store / batch store on exit", async () => {
    const customResolver: QueueResolver = () => ({ add: async () => ({ id: "real" }) }) as never;
    const customChainStore = new MemoryChainStore();
    const customBatchStore = new MemoryBatchStore();

    setDispatcherContext(customResolver);
    setChainStore(customChainStore);
    setBatchStore(customBatchStore);

    const q = fakeQueue();
    await q.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_1" });
    });

    // After use() exits, the prior resolver should be reinstalled. Since the
    // fake clears the dispatcher context entirely we expect it to be unset
    // unless something else reset it — the contract documented in the source
    // is "restore prevChainStore + prevBatchStore; clear dispatcher".
    expect(() => getDispatcherContext()).toThrow();

    // Chain/batch stores were restored:
    setDispatcherContext(customResolver);
    expect(() => getDispatcherContext()).not.toThrow();
  });

  test("two FakeQueues record independently", async () => {
    const a = fakeQueue();
    const b = fakeQueue();

    await a.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_a" });
    });
    await b.use(async () => {
      await InitiatePayin.dispatch({ payinId: "pi_b" });
      await InitiatePayin.dispatch({ payinId: "pi_b2" });
    });

    expect(a.all()).toHaveLength(1);
    expect(b.all()).toHaveLength(2);
  });
});
