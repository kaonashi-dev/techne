import {
  Body,
  Controller,
  CsrfExempt,
  Post,
  Public,
  RateLimit,
} from "../../../../src/common/index.ts";
import { JwtService } from "../../../../src/jwt/index.ts";
import { LoginDto } from "./dto/login.dto";

/**
 * Issues JWTs. The login route is:
 * - `@Public()` — skipped by `JwtAuthGuard` when that guard is in play.
 * - `@CsrfExempt()` — token endpoints are not cookie-CSRF protected.
 * - `@RateLimit(...)` — a tighter per-route limit than the global limiter.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Public()
  @CsrfExempt()
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @Post("/login")
  async login(@Body(LoginDto) dto: LoginDto) {
    // Demo-only: derive roles from the email. Real apps verify credentials.
    const roles = dto.email.startsWith("admin") ? ["admin"] : ["viewer"];
    const accessToken = await this.jwt.signAsync(
      { sub: dto.email, email: dto.email, roles },
      { expiresIn: "1h" },
    );
    return { tokenType: "Bearer", accessToken, roles };
  }
}
