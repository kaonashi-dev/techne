import { test, expect, describe } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Injectable } from "../src/decorators/injectable.decorator";

describe("TechneApplicationContext shutdown", () => {
  test("close() is idempotent and does not double-invoke onModuleDestroy", async () => {
    let destroyCount = 0;

    @Injectable()
    class TrackedService {
      onModuleDestroy() {
        destroyCount++;
      }
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [TrackedService],
      logger: false,
    });

    await app.close();
    expect(destroyCount).toBe(1);

    // Second close() must be a no-op: it should not throw and must not
    // re-invoke onModuleDestroy.
    await app.close();
    expect(destroyCount).toBe(1);

    // A third call confirms the guard sticks.
    await app.close();
    expect(destroyCount).toBe(1);
  });

  test("lifecycle hooks fire in the documented order", async () => {
    // The Techne core invokes lifecycle hooks via Scanner.callLifecycleHook().
    // Only three hooks are wired through the framework today:
    //   - onModuleInit              (during createApplicationContext, after
    //                                scanFlat + static provider materialization)
    //   - onApplicationBootstrap    (during TechneApplicationContext.init())
    //   - onModuleDestroy           (during TechneApplicationContext.close())
    //
    // `beforeApplicationShutdown` is part of the Nest convention but is NOT
    // currently called by the framework (see src/core/scanner.ts), so it is
    // intentionally not asserted here.
    const events: string[] = [];

    @Injectable()
    class OrderedService {
      onModuleInit() {
        events.push("onModuleInit");
      }
      onApplicationBootstrap() {
        events.push("onApplicationBootstrap");
      }
      onModuleDestroy() {
        events.push("onModuleDestroy");
      }
      // If `beforeApplicationShutdown` ever becomes wired, this push will
      // appear in `events` and the assertion below can be tightened.
      beforeApplicationShutdown() {
        events.push("beforeApplicationShutdown");
      }
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [OrderedService],
      logger: false,
    });

    // After createApplicationContext + init(), the first two hooks must have
    // already fired, in order.
    expect(events).toEqual(["onModuleInit", "onApplicationBootstrap"]);

    await app.close();

    // After close(), onModuleDestroy is appended. `beforeApplicationShutdown`
    // is not invoked by the current framework.
    expect(events).toEqual(["onModuleInit", "onApplicationBootstrap", "onModuleDestroy"]);
  });

  test("close() runs onModuleDestroy on every static provider", async () => {
    const events: string[] = [];

    @Injectable()
    class A {
      onModuleDestroy() {
        events.push("A");
      }
    }

    @Injectable()
    class B {
      onModuleDestroy() {
        events.push("B");
      }
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [A, B],
      logger: false,
    });

    await app.close();

    expect(events).toContain("A");
    expect(events).toContain("B");
    expect(events).toHaveLength(2);
  });

  // NOTE: MqRegistry teardown is intentionally NOT covered here.
  // MqRegistry is only constructed when a MQ_DRIVER token is registered in
  // the container (see TechneFactory.createApplicationContext); it is not a
  // standalone DI-exposed provider in a default app. Exercising its close()
  // would require wiring a real or mock queue driver, which belongs in the
  // dedicated queue/MQ tests rather than the application-context shutdown
  // contract. The relevant assertion — that `MqRegistry.close()` is awaited
  // before `onModuleDestroy` — is visible in src/core/application-context.ts
  // and is covered by the MQ-focused test suites.
});
