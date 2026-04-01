import { test, expect, describe } from "bun:test";
import { Test } from "../src/testing";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Inject } from "../src/decorators/inject.decorator";

describe("TestingModule", () => {
  test("should create an isolated module with providers", async () => {
    @Injectable()
    class CatService {
      findAll() {
        return ["cat1", "cat2"];
      }
    }

    const module = await Test.createTestingModule({
      providers: [CatService],
    }).compile();

    const catService = module.get<CatService>(CatService);
    expect(catService.findAll()).toEqual(["cat1", "cat2"]);
  });

  test("should override a provider with useValue", async () => {
    @Injectable()
    class CatService {
      findAll() {
        return ["real-cat"];
      }
    }

    const mockCatService = {
      findAll: () => ["mock-cat"],
    };

    const module = await Test.createTestingModule({
      providers: [CatService],
    })
      .overrideProvider(CatService)
      .useValue(mockCatService)
      .compile();

    const catService = module.get<CatService>(CatService);
    expect(catService.findAll()).toEqual(["mock-cat"]);
  });

  test("should override a provider with useClass", async () => {
    @Injectable()
    class OriginalService {
      getType() {
        return "original";
      }
    }

    @Injectable()
    class MockService {
      getType() {
        return "mock";
      }
    }

    const module = await Test.createTestingModule({
      providers: [OriginalService],
    })
      .overrideProvider(OriginalService)
      .useClass(MockService)
      .compile();

    const service = module.get<any>(OriginalService);
    expect(service.getType()).toBe("mock");
  });

  test("should override a provider with useFactory", async () => {
    @Injectable()
    class ConfigService {
      getDbUrl() {
        return "postgres://production";
      }
    }

    const module = await Test.createTestingModule({
      providers: [ConfigService],
    })
      .overrideProvider(ConfigService)
      .useFactory({ factory: () => ({ getDbUrl: () => "sqlite://test.db" }) })
      .compile();

    const config = module.get<ConfigService>(ConfigService);
    expect(config.getDbUrl()).toBe("sqlite://test.db");
  });

  test("should resolve dependencies in isolated container", async () => {
    @Injectable()
    class Database {
      name = "test-db";
    }

    @Injectable()
    class UserService {
      constructor(public db: Database) {}
    }

    const module = await Test.createTestingModule({
      providers: [Database, UserService],
    }).compile();

    const userService = module.get<UserService>(UserService);
    expect(userService.db).toBeInstanceOf(Database);
    expect(userService.db.name).toBe("test-db");
  });

  test("each TestingModule should be fully isolated", async () => {
    @Injectable()
    class CounterService {
      public count = 0;
      increment() {
        this.count++;
      }
    }

    const module1 = await Test.createTestingModule({
      providers: [CounterService],
    }).compile();

    const module2 = await Test.createTestingModule({
      providers: [CounterService],
    }).compile();

    const counter1 = module1.get<CounterService>(CounterService);
    const counter2 = module2.get<CounterService>(CounterService);

    counter1.increment();
    counter1.increment();

    expect(counter1.count).toBe(2);
    expect(counter2.count).toBe(0); // Completely isolated
  });

  test("should support custom providers with tokens", async () => {
    const TOKEN = Symbol("MY_TOKEN");

    const module = await Test.createTestingModule({
      providers: [{ provide: TOKEN, useValue: "injected-value" }],
    }).compile();

    const value = module.get<string>(TOKEN);
    expect(value).toBe("injected-value");
  });

  test("should chain multiple overrides", async () => {
    @Injectable()
    class ServiceA {
      value = "a";
    }

    @Injectable()
    class ServiceB {
      value = "b";
    }

    const module = await Test.createTestingModule({
      providers: [ServiceA, ServiceB],
    })
      .overrideProvider(ServiceA)
      .useValue({ value: "mock-a" })
      .overrideProvider(ServiceB)
      .useValue({ value: "mock-b" })
      .compile();

    expect(module.get<any>(ServiceA).value).toBe("mock-a");
    expect(module.get<any>(ServiceB).value).toBe("mock-b");
  });
});

describe("TestingModule with @Inject", () => {
  test("should resolve @Inject tokens in testing module", async () => {
    const API_URL = Symbol("API_URL");

    @Injectable()
    class ApiClient {
      constructor(@Inject(API_URL) public url: string) {}
    }

    const module = await Test.createTestingModule({
      providers: [{ provide: API_URL, useValue: "https://test-api.com" }, ApiClient],
    }).compile();

    const client = module.get<ApiClient>(ApiClient);
    expect(client.url).toBe("https://test-api.com");
  });
});

describe("TestingModule with lifecycle hooks", () => {
  test("should call onModuleInit during compile", async () => {
    let initialized = false;

    @Injectable()
    class StartupService {
      onModuleInit() {
        initialized = true;
      }
    }

    await Test.createTestingModule({
      providers: [StartupService],
    }).compile();

    expect(initialized).toBe(true);
  });
});
