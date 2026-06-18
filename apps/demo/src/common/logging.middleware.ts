import { Logger } from "../../../../src/common/index.ts";

const logger = new Logger("HTTP");

/**
 * A middleware function applied with `@Middleware(...)`. It runs before the
 * handler and logs the incoming request line. Middleware receives the raw
 * route context (Elysia's context object).
 */
export const requestLoggingMiddleware = async (context: any): Promise<void> => {
  const method = context?.request?.method ?? "?";
  const url = context?.request?.url ?? context?.path ?? "?";
  logger.debug(`${method} ${url}`);
};
