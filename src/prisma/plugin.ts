import { definePlugin } from "../core/plugins/define-plugin";
import { createPrismaClient } from "./client-loader";
import { PRISMA_CLIENT, PRISMA_MODULE_OPTIONS } from "./tokens";
import type { PrismaClientLike, PrismaModuleOptions } from "./types";

export function prisma(options: PrismaModuleOptions = {}) {
  return definePlugin({
    name: "prisma",
    async setup(ctx) {
      ctx.provide(PRISMA_MODULE_OPTIONS, options);

      const client: PrismaClientLike = options.clientFactory
        ? await options.clientFactory()
        : await createPrismaClient(options);

      ctx.provide(PRISMA_CLIENT, client);
      ctx.provide(client.constructor, client);

      if (options.healthcheck) {
        ctx.onReady(async () => {
          await client.$connect();
          await client.$queryRaw`SELECT 1`;
          ctx.logger.log("Prisma client connected");
        });
      }

      ctx.onShutdown(async () => {
        await client.$disconnect();
        ctx.logger.log("Prisma client disconnected");
      });
    },
  });
}
