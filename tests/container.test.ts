import { test, expect, describe } from "bun:test";
import { Container } from "../src/core/container";
import { Injectable } from "../src/decorators/injectable.decorator";

describe("Dependency Injection Container", () => {
  test("should instantiate a class without dependencies", () => {
    const container = new Container();

    @Injectable()
    class SimpleService {
      getValue() {
        return "simple";
      }
    }

    const instance = container.get<SimpleService>(SimpleService);
    expect(instance).toBeInstanceOf(SimpleService);
    expect(instance.getValue()).toBe("simple");
  });

  test("should return a singleton instance", () => {
    const container = new Container();

    @Injectable()
    class CounterService {
      public count = 0;
      increment() {
        this.count++;
      }
    }

    const instance1 = container.get<CounterService>(CounterService);
    const instance2 = container.get<CounterService>(CounterService);

    instance1.increment();

    expect(instance1).toBe(instance2);
    expect(instance2.count).toBe(1);
  });

  test("should resolve nested dependencies", () => {
    const container = new Container();

    @Injectable()
    class DatabaseService {
      getData() {
        return "data";
      }
    }

    @Injectable()
    class UserService {
      constructor(public db: DatabaseService) {}

      getUser() {
        return this.db.getData() + "_user";
      }
    }

    const userService = container.get<UserService>(UserService);

    expect(userService).toBeInstanceOf(UserService);
    expect(userService.db).toBeInstanceOf(DatabaseService);
    expect(userService.getUser()).toBe("data_user");
  });

  test("should detect circular dependencies", () => {
    const container = new Container();

    // We have to bypass TS checking to create a circular dependency
    // because decorators and constructor types usually prevent this at compile time

    class ServiceA {
      constructor(public b: any) {}
    }

    class ServiceB {
      constructor(public a: any) {}
    }

    Reflect.defineMetadata("design:paramtypes", [ServiceB], ServiceA);
    Reflect.defineMetadata("design:paramtypes", [ServiceA], ServiceB);

    expect(() => container.get(ServiceA)).toThrow(/Circular dependency detected/);
  });
});
