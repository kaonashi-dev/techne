import { Body, Controller, Cookie, CsrfExempt, Get, Post } from "../../../../src/common/index.ts";
import { resolveClientIp, setCookie } from "../../../../src/security/index.ts";
import { Ctx } from "../common/context.decorator";

/**
 * Cookie + client-IP demo.
 *
 * - `GET /cookies/me` reads the signed `session` cookie via `@Cookie`.
 * - `POST /cookies/session` is **CSRF-protected** (no `@CsrfExempt`): browser
 *   clients must echo the double-submit token in `x-csrf-token`.
 * - `POST /cookies/webhook` is `@CsrfExempt` — the signature-style escape hatch.
 */
@Controller("cookies")
export class CookiesController {
  @Get("/me")
  me(@Cookie("session") session: string | undefined, @Ctx() ctx: any) {
    return { session: session ?? null, ip: resolveClientIp(ctx) ?? null };
  }

  @Post("/session")
  start(@Body() body: { user?: string }, @Ctx() ctx: any) {
    setCookie(ctx.cookie, "session", body.user ?? "anonymous", { maxAge: 86_400 });
    return { ok: true };
  }

  @CsrfExempt()
  @Post("/webhook")
  webhook(@Body() payload: unknown) {
    return { received: payload };
  }
}
