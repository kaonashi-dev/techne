import { afterEach, describe, expect, test } from "bun:test";
import type { PluginContext } from "../src/core/plugins/define-plugin";
import { __setPrismaClientImporterForTests, createPrismaClient } from "../src/prisma/client-loader";
import { prisma } from "../src/prisma/plugin";
import { PRISMA_CLIENT } from "../src/prisma/tokens";

function missingPrismaError() {
  return Object.assign(new Error("Cannot find package '@prisma/client'"), {
    code: "ERR_MODULE_NOT_FOUND",
  });
}

function createPluginContext() {
  const values = new Map<any, any>();
  const readyHandlers: Array<() => void | Promise<void>> = [];
  const shutdownHandlers: Array<() => void | Promise<void>> = [];
  const ctx: PluginContext = {
    app: {} as any,
    options: Object.freeze({}),
    provide: (token, value) => {
      values.set(token, value);
    },
    registerProviders: () => {},
    resolve: (token) => values.get(token),
    onReady: (handler) => {
      readyHandlers.push(handler);
    },
    onShutdown: (handler) => {
      shutdownHandlers.push(handler);
    },
    http: () => ({}) as any,
    logger: {
      log: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      verbose: () => {},
    } as any,
  };

  return { ctx, values, readyHandlers, shutdownHandlers };
}

describe("prisma missing package handling", () => {
  afterEach(() => {
    __setPrismaClientImporterForTests();
  });

  test("throws a contextual install error from the loader", async () => {
    __setPrismaClientImporterForTests(async () => {
      throw missingPrismaError();
    });

    await expect(createPrismaClient()).rejects.toThrow(
      /bun add @prisma\/client && bun add -D prisma/,
    );
  });

  test("throws during plugin setup only when no clientFactory is provided", async () => {
    __setPrismaClientImporterForTests(async () => {
      throw missingPrismaError();
    });

    const { ctx, readyHandlers } = createPluginContext();

    await expect(prisma().setup(ctx, undefined)).rejects.toThrow(/bunx prisma generate/);
    expect(readyHandlers).toHaveLength(0);
  });

  test("does not import @prisma/client when clientFactory is provided", async () => {
    __setPrismaClientImporterForTests(async () => {
      throw missingPrismaError();
    });

    const fakeClient = {
      $connect: async () => {},
      $disconnect: async () => {},
      $queryRaw: async () => [{ ok: 1 }],
    };
    const { ctx, values, readyHandlers, shutdownHandlers } = createPluginContext();

    await prisma({ clientFactory: () => fakeClient }).setup(ctx, undefined);

    expect(values.get(PRISMA_CLIENT)).toBe(fakeClient);
    expect(readyHandlers).toHaveLength(0);
    expect(shutdownHandlers).toHaveLength(1);
  });
});
