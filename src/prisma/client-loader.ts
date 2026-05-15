import type { PrismaClientLike, PrismaModuleOptions } from "./types";

interface PrismaClientConstructorOptions {
  datasourceUrl?: string;
  log?: PrismaModuleOptions["log"];
  errorFormat?: PrismaModuleOptions["errorFormat"];
}

type PrismaClientConstructor = new (options?: PrismaClientConstructorOptions) => PrismaClientLike;
type PrismaClientImporter = () => Promise<{ PrismaClient: PrismaClientConstructor }>;

let prismaClientImporter: PrismaClientImporter = () => import("@prisma/client") as any;

export function __setPrismaClientImporterForTests(importer?: PrismaClientImporter): void {
  prismaClientImporter = importer ?? (() => import("@prisma/client") as any);
}

export async function createPrismaClient(
  options: PrismaModuleOptions = {},
): Promise<PrismaClientLike> {
  try {
    const mod = await prismaClientImporter();
    const clientOptions: PrismaClientConstructorOptions = {};
    if (options.datasourceUrl) clientOptions.datasourceUrl = options.datasourceUrl;
    if (options.log) clientOptions.log = options.log;
    if (options.errorFormat) clientOptions.errorFormat = options.errorFormat;
    return new mod.PrismaClient(Object.keys(clientOptions).length ? clientOptions : undefined);
  } catch (error: any) {
    const code = error?.code;
    const message = String(error?.message ?? error);
    if (code === "ERR_MODULE_NOT_FOUND" || message.includes("@prisma/client")) {
      throw new Error(
        "Prisma plugin requires @prisma/client. Install it with `bun add @prisma/client && bun add -D prisma`, then run `bunx prisma generate`.",
      );
    }
    throw error;
  }
}
