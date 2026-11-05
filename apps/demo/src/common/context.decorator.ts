import { createParamDecorator } from "../../../../src/common/index.ts";

/**
 * Injects the raw route context (the native HTTP context: `request`, `set`, `cookie`,
 * `server`, …). Handy for low-level helpers like `setCookie` / `resolveClientIp`.
 */
export const Ctx = createParamDecorator((_data: undefined, ctx: any) => ctx?.ctx);
