import { test, expect, describe, beforeEach } from "bun:test";
import { Container } from "../src/core/container";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Inject } from "../src/decorators/inject.decorator";

describe("Custom Providers", () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe("useValue", () => {
    test("should resolve a provider with useValue", () => {
      const CONFIG_TOKEN = Symbol("CONFIG");
      container.addProvider({
        provide: CONFIG_TOKEN,
        useValue: { apiUrl: "https://api.example.com", timeout: 5000 },
      });

      const config = container.get<{ apiUrl: string; timeout: number }>(CONFIG_TOKEN);
      expect(config.apiUrl).toBe("https://api.example.com");
      expect(config.timeout).toBe(5000);
    });

    test("should resolve useValue with string token", () => {
      container.addProvider({
        provide: "DATABASE_URL",
        useValue: "postgres://localhost:5432/mydb",
      });

      const url = container.get<string>("DATABASE_URL");
      expect(url).toBe("postgres://localhost:5432/mydb");
    });

    test("should allow null/undefined/false as useValue", () => {
      container.addProvider({ provide: "NULL_VAL", useValue: null });
      container.addProvider({ provide: "FALSE_VAL", useValue: false });

      expect(container.get("NULL_VAL")).toBeNull();
      expect(container.get("FALSE_VAL")).toBe(false);
    });
  });

  describe("useClass", () => {
    test("should resolve a provider with useClass", () => {
      @Injectable()
      class ConcreteLogger {
        log(msg: string) {
          return `[LOG] ${msg}`;
        }
      }

      const LOGGER_TOKEN = Symbol("LOGGER");
      container.addProvider({
        provide: LOGGER_TOKEN,
        useClass: ConcreteLogger,
      });

      const logger = container.get<ConcreteLogger>(LOGGER_TOKEN);
      expect(logger.log("hello")).toBe("[LOG] hello");
    });

    test("should resolve useClass with dependencies", () => {
      @Injectable()
      class Database {
        query() {
          return "result";
        }
      }

      @Injectable()
      class Repository {
        constructor(public db: Database) {}
        find() {
          return this.db.query();
        }
      }

      const REPO_TOKEN = Symbol("REPO");
      container.addProvider({
        provide: REPO_TOKEN,
        useClass: Repository,
      });

      const repo = container.get<Repository>(REPO_TOKEN);
      expect(repo.find()).toBe("result");
    });
  });

  describe("useFactory", () => {
    test("should resolve a provider with useFactory", () => {
      container.addProvider({
        provide: "CONNECTION",
        useFactory: () => ({ connected: true, host: "localhost" }),
      });

      const conn = container.get<{ connected: boolean; host: string }>("CONNECTION");
      expect(conn.connected).toBe(true);
      expect(conn.host).toBe("localhost");
    });

    test("should inject dependencies into factory", () => {
      container.addProvider({
        provide: "PORT",
        useValue: 3000,
      });

      container.addProvider({
        provide: "HOST",
        useValue: "localhost",
      });

      container.addProvider({
        provide: "URL",
        useFactory: (host: string, port: number) => `http://${host}:${port}`,
        inject: ["HOST", "PORT"],
      });

      const url = container.get<string>("URL");
      expect(url).toBe("http://localhost:3000");
    });
  });

  describe("useExisting", () => {
    test("should alias a provider with useExisting", () => {
      @Injectable()
      class RealService {
        getName() {
          return "real";
        }
      }

      container.get(RealService); // register it

      container.addProvider({
        provide: "ALIAS",
        useExisting: RealService,
      });

      const aliased = container.get<RealService>("ALIAS");
      const real = container.get<RealService>(RealService);
      expect(aliased).toBe(real);
      expect(aliased.getName()).toBe("real");
    });
  });
});

describe("@Inject decorator", () => {
  test("should inject by token in constructor", () => {
    const container = new Container();

    const API_KEY = Symbol("API_KEY");
    container.addProvider({
      provide: API_KEY,
      useValue: "secret-key-123",
    });

    @Injectable()
    class ApiService {
      constructor(@Inject(API_KEY) public apiKey: string) {}
    }

    const service = container.get<ApiService>(ApiService);
    expect(service.apiKey).toBe("secret-key-123");
  });

  test("should inject multiple tokens", () => {
    const container = new Container();

    container.addProvider({ provide: "HOST", useValue: "localhost" });
    container.addProvider({ provide: "PORT", useValue: 8080 });

    @Injectable()
    class ServerConfig {
      constructor(
        @Inject("HOST") public host: string,
        @Inject("PORT") public port: number,
      ) {}
    }

    const config = container.get<ServerConfig>(ServerConfig);
    expect(config.host).toBe("localhost");
    expect(config.port).toBe(8080);
  });

  test("should mix @Inject with class-based injection", () => {
    const container = new Container();

    @Injectable()
    class Database {
      getUrl() {
        return "db://local";
      }
    }

    container.addProvider({ provide: "TABLE_PREFIX", useValue: "app_" });

    @Injectable()
    class Repository {
      constructor(
        public db: Database,
        @Inject("TABLE_PREFIX") public prefix: string,
      ) {}
    }

    const repo = container.get<Repository>(Repository);
    expect(repo.db).toBeInstanceOf(Database);
    expect(repo.prefix).toBe("app_");
  });
});

describe("Container reset", () => {
  test("should clear all instances and providers", () => {
    const container = new Container();

    @Injectable()
    class MyService {
      public value = Math.random();
    }

    const first = container.get<MyService>(MyService);
    container.reset();
    const second = container.get<MyService>(MyService);

    expect(first.value).not.toBe(second.value);
  });

  test("should clear custom providers on reset", () => {
    const container = new Container();
    container.addProvider({ provide: "KEY", useValue: "old" });
    expect(container.get("KEY")).toBe("old");

    container.reset();
    expect(() => container.get("KEY")).toThrow();
  });
});
