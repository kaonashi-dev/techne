import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Inject } from "../src/decorators/inject.decorator";
import { InjectPrisma } from "../src/prisma/inject-prisma.decorator";
import { prisma } from "../src/prisma/plugin";
import { PRISMA_CLIENT, PRISMA_MODULE_OPTIONS } from "../src/prisma/tokens";

class FakePrismaClient {
  calls: string[] = [];

  async $connect() {
    this.calls.push("connect");
  }

  async $disconnect() {
    this.calls.push("disconnect");
  }

  async $queryRaw(..._args: any[]) {
    this.calls.push("query");
    return [{ ok: 1 }];
  }
}

describe("prisma plugin", () => {
  test("wires the client into DI and skips eager $connect by default", async () => {
    const fakeClient = new FakePrismaClient();

    @Injectable()
    class InjectPrismaService {
      constructor(@InjectPrisma() public readonly db: FakePrismaClient) {}
    }

    @Injectable()
    class InjectTokenService {
      constructor(@Inject(PRISMA_CLIENT) public readonly db: FakePrismaClient) {}
    }

    const app = await TechneFactory.create({
      logger: false,
      providers: [InjectPrismaService, InjectTokenService],
      plugins: [prisma({ clientFactory: () => fakeClient })],
    });

    expect(app.get(PRISMA_CLIENT)).toBe(fakeClient);
    expect(app.get(PRISMA_MODULE_OPTIONS)).toEqual({
      clientFactory: expect.any(Function),
    });
    expect(app.get(InjectPrismaService).db).toBe(fakeClient);
    expect(app.get(InjectTokenService).db).toBe(fakeClient);
    expect(fakeClient.calls).toEqual([]);

    await app.listen(0);
    expect(fakeClient.calls).toEqual([]);

    await app.close();
    expect(fakeClient.calls).toEqual(["disconnect"]);
  });

  test("resolves the same instance under PRISMA_CLIENT and the runtime constructor", async () => {
    const fakeClient = new FakePrismaClient();

    @Injectable()
    class ConstructorService {
      constructor(public readonly db: FakePrismaClient) {}
    }

    const app = await TechneFactory.create({
      logger: false,
      providers: [ConstructorService],
      plugins: [prisma({ clientFactory: () => fakeClient })],
    });

    expect(app.get(PRISMA_CLIENT)).toBe(fakeClient);
    expect(app.get(FakePrismaClient)).toBe(fakeClient);
    expect(app.get(ConstructorService).db).toBe(fakeClient);

    await app.close();
  });

  test("eager connect + SELECT 1 only when healthcheck is enabled", async () => {
    const fakeClient = new FakePrismaClient();

    const app = await TechneFactory.create({
      logger: false,
      plugins: [prisma({ clientFactory: () => fakeClient, healthcheck: true })],
    });

    expect(fakeClient.calls).toEqual([]);

    await app.listen(0);
    expect(fakeClient.calls).toEqual(["connect", "query"]);

    await app.close();
    expect(fakeClient.calls).toEqual(["connect", "query", "disconnect"]);
  });

  test("exports the scoped public API", async () => {
    const api = await import("@kaonashi-dev/techne/prisma");

    expect(typeof api.prisma).toBe("function");
    expect(typeof api.InjectPrisma).toBe("function");
    expect(api.PRISMA_CLIENT).toBeDefined();
    expect("createPrismaClient" in api).toBe(false);
  });
});
