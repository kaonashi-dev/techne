/**
 * Client-IP resolution with explicit trusted-proxy semantics.
 *
 * The socket peer address (`server.requestIP()`) is the only value a server
 * can trust on its own; `X-Forwarded-For` / `X-Real-IP` are attacker-supplied
 * unless a proxy the operator controls overwrites or appends them. Forwarding
 * headers are therefore only consulted when `trustProxy` is explicitly
 * enabled.
 */

export interface TrustProxyOptions {
  /** Which proxy-supplied header carries the client address. Default: "x-forwarded-for". */
  header?: "x-forwarded-for" | "x-real-ip";
  /**
   * Number of trusted proxies in front of the server. Each proxy appends the
   * address of the peer that connected to it, so with N trusted hops the
   * client is the Nth entry from the right of `X-Forwarded-For`. Default: 1.
   */
  hops?: number;
}

/**
 * Resolves the client IP for an Elysia request context.
 *
 * With `trustProxy` falsy (the default), returns the socket peer address.
 * With `trustProxy: true` (or options), reads the forwarding header using
 * rightmost-hops semantics and falls back to the socket address when the
 * header is absent or empty. Returns `undefined` when no address can be
 * determined (e.g. `app.handle()` calls that never touch a socket).
 */
export function resolveClientIp(
  ctx: any,
  trustProxy?: boolean | TrustProxyOptions,
): string | undefined {
  if (trustProxy) {
    const opts = trustProxy === true ? undefined : trustProxy;
    const headerName = opts?.header ?? "x-forwarded-for";
    const raw = ctx?.request?.headers?.get?.(headerName);
    if (typeof raw === "string" && raw.length > 0) {
      if (headerName === "x-real-ip") {
        const value = raw.trim();
        if (value.length > 0) return value;
      } else {
        const parts = raw.split(",");
        const hops = opts?.hops ?? 1;
        const index = parts.length - hops;
        const value = parts[index < 0 ? 0 : index]?.trim();
        if (value && value.length > 0) return value;
      }
    }
  }
  return ctx?.server?.requestIP?.(ctx.request)?.address ?? undefined;
}
