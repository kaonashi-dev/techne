import { createParamDecorator } from "../../../../src/common/index.ts";

/**
 * Injects the raw route context (Elysia's context: `request`, `set`, `cookie`,
 * `server`, …). Handy for low-level helpers like `setCookie` / `resolveClientIp`.
 */
export const Ctx = createParamDecorator((_data: undefined, ctx: any) => ctx?.ctx);
