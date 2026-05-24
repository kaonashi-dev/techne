import { afterEach, describe, expect, test } from "bun:test";
import { Injectable } from "../src/common";
import { TechneFactory } from "../src/factory/techne-factory";
import {
  Backoff,
  Dispatchable,
  OnQueue,
  Queueable,
  Timeout,
  Tries,
  clearDispatcherContext,
  clearSyncHandlers,
  defineQueue,
  mq,
  withDispatcherContext,
  type QueueResolver,
} from "../src/mq";

type Captured = { q: string; name: string; payload: unknown; opts: unknown };

function fakeResolver(captured: Captured[]): QueueResolver {
  return (queueName) =>
    ({
      add: async (jobName: string, payload: unknown, opts: unknown) => {
        captured.push({ q: queueName, name: jobName, payload, opts });
        return { id: "fake" };
      },
    }) as any;
}

describe("mq class-level defaults (Phase 2)", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
    clearDispatcherContext();
    clearSyncHandlers();
  });

  test("@Tries default is used when no per-call override", async () => {
    const Q = defineQueue({ name: "def-tries", jobs: { run: {} as { id: string } } });

    @Queueable()
    @Tries(3)
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => RunJob.dispatch({ id: "x" }));

    expect((captured[0]?.opts as any)?.attempts).toBe(3);
  });

  test("per-call .tries() wins over @Tries default", async () => {
    const Q = defineQueue({ name: "override-tries", jobs: { run: {} as { id: string } } });

    @Queueable()
    @Tries(3)
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () =>
      RunJob.dispatch({ id: "x" }).tries(7),
    );

    expect((captured[0]?.opts as any)?.attempts).toBe(7);
  });

  test("@Backoff default is applied to dispatch", async () => {
    const Q = defineQueue({ name: "def-backoff", jobs: { run: {} as { id: string } } });

    @Queueable()
    @Backoff([5_000, 15_000, 30_000])
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => RunJob.dispatch({ id: "x" }));

    expect((captured[0]?.opts as any)?.backoff).toEqual({ type: "fixed", delay: 5_000 });
  });

  test("@Timeout default is applied to dispatch", async () => {
    const Q = defineQueue({ name: "def-timeout", jobs: { run: {} as { id: string } } });

    @Queueable()
    @Timeout(120_000)
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => RunJob.dispatch({ id: "x" }));

    expect((captured[0]?.opts as any)?.timeout).toBe(120_000);
  });

  test("@OnQueue redirects dispatch to the named queue", async () => {
    const Q = defineQueue({ name: "def-onqueue-base", jobs: { run: {} as { id: string } } });

    @Queueable()
    @OnQueue("def-onqueue-priority")
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => RunJob.dispatch({ id: "x" }));

    expect(captured[0]?.q).toBe("def-onqueue-priority");
  });

  test("per-call .onQueue() wins over @OnQueue default", async () => {
    const Q = defineQueue({ name: "onqueue-base2", jobs: { run: {} as { id: string } } });

    @Queueable()
    @OnQueue("onqueue-priority2")
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () =>
      RunJob.dispatch({ id: "x" }).onQueue("onqueue-override"),
    );

    expect(captured[0]?.q).toBe("onqueue-override");
  });

  test("all four class-level defaults apply together", async () => {
    const Q = defineQueue({ name: "def-all", jobs: { run: {} as { id: string } } });

    @Queueable()
    @Tries(5)
    @Backoff({ type: "exponential", delay: 1_000 })
    @Timeout(60_000)
    @OnQueue("def-all-priority")
    class RunJob extends Dispatchable<{ id: string }> {
      static override queue = Q;
      static override jobName = "run";
      async handle() {}
    }

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => RunJob.dispatch({ id: "x" }));

    expect(captured[0]?.q).toBe("def-all-priority");
    expect((captured[0]?.opts as any)?.attempts).toBe(5);
    expect((captured[0]?.opts as any)?.backoff).toEqual({ type: "exponential", delay: 1_000 });
    expect((captured[0]?.opts as any)?.timeout).toBe(60_000);
  });

  test("defineQueue defaults block is applied via dispatchers map", async () => {
    const Q = defineQueue({
      name: "def-obj-defaults",
      jobs: { run: {} as { id: string } },
      defaults: {
        run: { tries: 4, backoff: [10_000, 30_000], timeout: 90_000 },
      },
    });

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => Q.dispatchers.run({ id: "y" }));

    const opts = captured[0]?.opts as any;
    expect(opts?.attempts).toBe(4);
    expect(opts?.backoff).toEqual({ type: "fixed", delay: 10_000 });
    expect(opts?.timeout).toBe(90_000);
  });

  test("per-call override beats defineQueue defaults", async () => {
    const Q = defineQueue({
      name: "def-obj-override",
      jobs: { run: {} as { id: string } },
      defaults: { run: { tries: 4 } },
    });

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () =>
      Q.dispatchers.run({ id: "y" }).tries(9),
    );

    expect((captured[0]?.opts as any)?.attempts).toBe(9);
  });

  test("defineQueue defaults onQueue redirects via dispatchers map", async () => {
    const Q = defineQueue({
      name: "def-obj-onqueue",
      jobs: { run: {} as { id: string } },
      defaults: { run: { onQueue: "def-obj-onqueue-priority" } },
    });

    const captured: Captured[] = [];
    await withDispatcherContext(fakeResolver(captured), () => Q.dispatchers.run({ id: "z" }));

    expect(captured[0]?.q).toBe("def-obj-onqueue-priority");
  });

  test("class-level @Tries default applies to dispatchSync path", async () => {
    const Q = defineQueue({
      name: "def-sync-tries",
      jobs: { run: {} as { id: string } },
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
    @Tries(2)
    class RunJob extends Dispatchable<{ id: string }, string> {
      static override queue = Q;
      static override jobName = "run";
      constructor(private readonly tracker: Tracker) {
        super();
      }
      async handle({ id }: { id: string }) {
        this.tracker.record(id);
        return `ok:${id}`;
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Q] })],
      providers: [Tracker, RunJob],
      logger: false,
    });
    closers.push(() => ctx.close());

    const result = await RunJob.dispatchSync({ id: "sync-test" });
    expect(result).toBe("ok:sync-test");
    expect(seen).toEqual(["sync-test"]);
  });
});
