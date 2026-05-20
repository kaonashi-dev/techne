import { afterEach, describe, expect, test } from "bun:test";
import { createMqDriver } from "../src/mq/driver";
import { MemoryQueueDriver } from "../src/mq/drivers/memory";
import type { QueueDriver, QueueEvent } from "../src/mq/types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Direct unit tests against the in-memory mq driver. No `TechneFactory`, no
 * `@InjectMq`, no `Worker` — just the `QueueDriver` interface. The `mq`
 * driver is a job queue (not a pub/sub bus), so the round-trip is
 * `add → claimNext`, and `subscribe` streams `QueueEvent`s rather than raw
 * topic messages.
 */
describe("MemoryQueueDriver (mq, direct)", () => {
  const drivers: QueueDriver[] = [];
  afterEach(async () => {
    await Promise.allSettled(drivers.splice(0).map((driver) => driver.close()));
  });

  test("createMqDriver({}) returns the memory driver by default", () => {
    const driver = createMqDriver({});
    drivers.push(driver);
    expect(driver).toBeInstanceOf(MemoryQueueDriver);
  });

  test("add → claimNext round-trips a job", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    await driver.add("orders", "place", { amount: 100 }, {});
    const claimed = await driver.claimNext("orders", {
      lockToken: "tok-1",
      lockDuration: 1_000,
      blockTimeout: 50,
    });

    expect(claimed).not.toBeNull();
    expect(claimed!.name).toBe("place");
    expect(claimed!.data).toEqual({ amount: 100 });
    expect(claimed!.state).toBe("active");
    expect(claimed!.lockToken).toBe("tok-1");
  });

  test("multiple subscribers on the same queue each receive emitted events", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    const seenA: QueueEvent[] = [];
    const seenB: QueueEvent[] = [];

    const unsubA = await driver.subscribe("notifications", (event) => seenA.push(event));
    const unsubB = await driver.subscribe("notifications", (event) => seenB.push(event));

    await driver.add("notifications", "send", { to: "alice" }, {});
    // `add` synchronously emits `waiting`; give the EventEmitter loop a tick.
    await sleep(0);

    expect(seenA.some((e) => e.event === "waiting")).toBe(true);
    expect(seenB.some((e) => e.event === "waiting")).toBe(true);

    await unsubA();
    await unsubB();
  });

  test("preserves publish order across many adds", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    const names = ["first", "second", "third", "fourth", "fifth"];
    for (const name of names) {
      await driver.add("inbox", name, { name }, {});
    }

    const claimed: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const job = await driver.claimNext("inbox", {
        lockToken: `tok-${i}`,
        lockDuration: 1_000,
        blockTimeout: 25,
      });
      expect(job).not.toBeNull();
      claimed.push(job!.name);
    }

    expect(claimed).toEqual(names);
  });

  test("claimNext on an empty queue resolves to null after blockTimeout", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    const start = Date.now();
    const result = await driver.claimNext("never-populated", {
      lockToken: "tok-empty",
      lockDuration: 1_000,
      blockTimeout: 40,
    });
    const elapsed = Date.now() - start;

    expect(result).toBeNull();
    // The driver must respect blockTimeout — not return immediately, nor hang.
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(elapsed).toBeLessThan(500);
  });

  test("subscribe() to a never-used queue installs cleanly and unsubscribe is safe", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    const events: QueueEvent[] = [];
    const unsub = await driver.subscribe("unknown-queue", (event) => events.push(event));

    // No events should arrive — we never added anything.
    await sleep(20);
    expect(events).toEqual([]);

    // Unsubscribing must not throw, and a subsequent add must not deliver events.
    await unsub();
    await driver.add("unknown-queue", "task", { n: 1 }, {});
    await sleep(0);
    expect(events).toEqual([]);
  });

  test("complete emits a 'completed' event that subscribers observe", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    const seen: QueueEvent[] = [];
    const unsub = await driver.subscribe("emails", (event) => seen.push(event));

    await driver.add("emails", "welcome", { to: "x@y" }, {});
    const job = await driver.claimNext("emails", {
      lockToken: "tok-c",
      lockDuration: 1_000,
      blockTimeout: 25,
    });
    expect(job).not.toBeNull();
    await driver.complete("emails", job!.id, "tok-c", { delivered: true });
    await sleep(0);

    const events = seen.map((e) => e.event);
    expect(events).toContain("waiting");
    expect(events).toContain("active");
    expect(events).toContain("completed");

    await unsub();
  });

  test("getJobCounts reflects waiting/active/completed transitions", async () => {
    const driver = new MemoryQueueDriver();
    drivers.push(driver);

    await driver.add("metrics", "a", { n: 1 }, {});
    await driver.add("metrics", "b", { n: 2 }, {});
    expect(await driver.getJobCounts("metrics", ["waiting", "active", "completed"])).toEqual({
      waiting: 2,
      active: 0,
      completed: 0,
    });

    const job = await driver.claimNext("metrics", {
      lockToken: "tok-m",
      lockDuration: 1_000,
      blockTimeout: 25,
    });
    expect(job).not.toBeNull();
    expect(await driver.getJobCounts("metrics", ["waiting", "active"])).toEqual({
      waiting: 1,
      active: 1,
    });

    await driver.complete("metrics", job!.id, "tok-m");
    expect(await driver.getJobCounts("metrics", ["waiting", "active", "completed"])).toEqual({
      waiting: 1,
      active: 0,
      completed: 1,
    });
  });
});
