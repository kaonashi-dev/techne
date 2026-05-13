import { definePlugin } from "../define-plugin";

export interface RequestIdPluginOptions {
  /** Header to read/write the request id from. Default: `x-request-id`. */
  header?: string;
}

/**
 * Opt-in plugin that stamps a UUID onto `ctx.store.requestId` for every
 * inbound request when one isn't already set by the adapter or an inbound
 * header. The default `ElysiaAdapter` already handles this for first-party
 * use; this plugin exists as a proof-of-concept for the plugin API and as
 * an extension point for users who disable the adapter-level behavior.
 *
 * Off by default — only takes effect when explicitly registered via
 * `app.register(requestIdPlugin, { header })`.
 */
export const requestIdPlugin = definePlugin<RequestIdPluginOptions | undefined>({
  name: "bnest:request-id",
  version: "1.0.0",
  setup(ctx, options) {
    const header = options?.header ?? "x-request-id";
    const elysia = ctx.http() as any;

    elysia.onRequest((reqCtx: any) => {
      reqCtx.store = reqCtx.store ?? {};
      if (typeof reqCtx.store.requestId === "string" && reqCtx.store.requestId.length > 0) {
        return;
      }
      const inbound = reqCtx.request.headers.get(header);
      if (typeof inbound === "string" && inbound.length > 0) {
        reqCtx.store.requestId = inbound;
        return;
      }
      reqCtx.store.requestId = generateRequestId();
    });

    ctx.logger.debug(`registered (header=${header})`);
  },
});

function generateRequestId(): string {
  const bun: any = typeof Bun !== "undefined" ? (Bun as any) : undefined;
  if (bun && typeof bun.randomUUIDv7 === "function") {
    try {
      return bun.randomUUIDv7();
    } catch {
      // fall through
    }
  }
  return crypto.randomUUID();
}
