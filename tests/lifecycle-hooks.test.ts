import { test, expect, describe } from "bun:test";
import { Container } from "../src/core/container";
import { Scanner } from "../src/core/scanner";
import { Injectable } from "../src/decorators/injectable.decorator";

async function bootFlatProviders(scanner: Scanner, container: Container, providers: any[]) {
  scanner.scanFlat({ providers });
  for (const provider of providers) {
    if (container.isStatic(provider)) {
      container.get(provider);
    }
  }
  await scanner.callLifecycleHook("onModuleInit");
}

describe("Lifecycle Hooks", () => {
  test("should call onModuleInit on flat providers during bootstrap", async () => {
    const events: string[] = [];
    @Injectable()
    class DatabaseService {
      onModuleInit() {
        events.push("db:init");
      }
    }
    @Injectable()
    class CacheService {
      onModuleInit() {
        events.push("cache:init");
      }
    }
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    await bootFlatProviders(scanner, container, [DatabaseService, CacheService]);
    expect(events).toContain("db:init");
    expect(events).toContain("cache:init");
  });
  test("should call onModuleDestroy when triggered", async () => {
    const events: string[] = [];
    @Injectable()
    class ConnectionService {
      onModuleDestroy() {
        events.push("connection:destroyed");
      }
    }
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    await bootFlatProviders(scanner, container, [ConnectionService]);
    await scanner.callLifecycleHook("onModuleDestroy");
    expect(events).toContain("connection:destroyed");
  });
  test("should call onApplicationBootstrap when triggered", async () => {
    const events: string[] = [];
    @Injectable()
    class HealthService {
      onApplicationBootstrap() {
        events.push("health:ready");
      }
    }
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    await bootFlatProviders(scanner, container, [HealthService]);
    await scanner.callLifecycleHook("onApplicationBootstrap");
    expect(events).toContain("health:ready");
  });
  test("should handle async lifecycle hooks", async () => {
    const events: string[] = [];
    @Injectable()
    class AsyncService {
      async onModuleInit() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push("async:init");
      }
    }
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    await bootFlatProviders(scanner, container, [AsyncService]);
    // onModuleInit is called during scan, but async hooks may need explicit await
    await scanner.callLifecycleHook("onModuleInit");
    expect(events).toContain("async:init");
  });
  test("should not fail if provider has no lifecycle hooks", async () => {
    @Injectable()
    class SimpleService {
      getValue() {
        return 42;
      }
    }
    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    // Should not throw
    await bootFlatProviders(scanner, container, [SimpleService]);
    await scanner.callLifecycleHook("onModuleDestroy");
  });
});
