import { test, expect, describe } from "bun:test";
import { Container } from "../src/core/container";
import { Scanner } from "../src/core/scanner";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";

describe("Lifecycle Hooks", () => {
  test("should call onModuleInit on providers during scan", async () => {
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

    @Module({
      providers: [DatabaseService, CacheService],
    })
    class AppModule {}

    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    scanner.scan(AppModule);

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

    @Module({
      providers: [ConnectionService],
    })
    class AppModule {}

    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    scanner.scan(AppModule);

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

    @Module({
      providers: [HealthService],
    })
    class AppModule {}

    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    scanner.scan(AppModule);

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

    @Module({
      providers: [AsyncService],
    })
    class AppModule {}

    const container = new Container();
    const scanner = new Scanner({ logger: false, container });
    scanner.scan(AppModule);

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

    @Module({
      providers: [SimpleService],
    })
    class AppModule {}

    const container = new Container();
    const scanner = new Scanner({ logger: false, container });

    // Should not throw
    expect(() => scanner.scan(AppModule)).not.toThrow();
    await scanner.callLifecycleHook("onModuleDestroy");
  });
});
