export type PrismaLogLevel = "info" | "query" | "warn" | "error";
export type PrismaErrorFormat = "pretty" | "colorless" | "minimal";

export interface PrismaClientLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(...args: any[]): Promise<unknown>;
  [key: string]: any;
}

export interface PrismaModuleOptions {
  /** Overrides DATABASE_URL for the generated Prisma client. */
  datasourceUrl?: string;
  log?: PrismaLogLevel[];
  errorFormat?: PrismaErrorFormat;
  healthcheck?: boolean;
  /** Bring your own Prisma client, for $extends(), middleware, or tests. */
  clientFactory?: () => PrismaClientLike | Promise<PrismaClientLike>;
}
