import { describe, expect, test } from "bun:test";
import { createResources, type OnClose } from "../src";

describe("application resources", () => {
  test("owns values per application and closes once in reverse acquisition order", async () => {
    const events: string[] = [];
    const resources = await createResources(async (onClose) => {
      onClose(() => {
        events.push("database");
      });
      await Promise.resolve();
      onClose(async () => {
        await Promise.resolve();
        events.push("worker");
      });
      return { database: { connected: true } };
    });
    expect(resources.value.database.connected).toBe(true);
    const first = resources.close();
    expect(resources.close()).toBe(first);
    await Promise.all([first, resources[Symbol.asyncDispose]()]);
    expect(events).toEqual(["worker", "database"]);
  });

  test("rolls back successful acquisitions when later setup fails", async () => {
    const failure = new Error("Worker unavailable");
    let closed = false;
    const setup = createResources(async (onClose) => {
      onClose(() => {
        closed = true;
      });
      await Promise.resolve();
      throw failure;
    });
    await expect(setup).rejects.toBe(failure);
    expect(closed).toBe(true);
  });

  test("runs every cleanup and preserves startup and cleanup failures", async () => {
    const startup = new Error("startup");
    const one = new Error("one");
    const two = new Error("two");
    const setup = createResources((onClose) => {
      onClose(() => {
        throw one;
      });
      onClose(async () => {
        throw two;
      });
      throw startup;
    });
    try {
      await setup;
      throw new Error("Expected setup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([startup, two, one]);
      expect((error as AggregateError).cause).toBe(startup);
    }
  });

  test("failed close is idempotent and late cleanup registration is rejected", async () => {
    let register!: OnClose;
    let calls = 0;
    const failure = new Error("disconnect failed");
    const resources = await createResources((onClose) => {
      register = onClose;
      onClose(() => {
        calls++;
        throw failure;
      });
      return 42;
    });
    expect(() => register(() => {})).toThrow("during setup");
    const closing = resources.close();
    await expect(closing).rejects.toBeInstanceOf(AggregateError);
    expect(resources.close()).toBe(closing);
    expect(calls).toBe(1);
  });

  test("supports await using without shared global resource state", async () => {
    const closed: number[] = [];
    const setup = (id: number) =>
      createResources((onClose) => {
        onClose(() => {
          closed.push(id);
        });
        return id;
      });
    const outside = await setup(1);
    {
      await using inside = await setup(2);
      expect(inside.value).toBe(2);
    }
    expect(closed).toEqual([2]);
    await outside.close();
    expect(closed).toEqual([2, 1]);
  });
});
