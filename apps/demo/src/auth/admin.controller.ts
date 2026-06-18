import { Controller, Get, Roles, UseGuards } from "../../../../src/common/index.ts";
import { RolesGuard } from "../../../../src/common/index.ts";
import { JwtAuthGuard } from "../../../../src/jwt/index.ts";
import { CurrentUser } from "../common/current-user.decorator";

/**
 * Protected controller. `@UseGuards(JwtAuthGuard, RolesGuard)` runs in order:
 * the JWT guard authenticates and attaches the payload, then the roles guard
 * enforces `@Roles("admin")`. The custom `@CurrentUser` decorator reads the
 * authenticated payload.
 */
@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Roles("admin")
  @Get("/dashboard")
  dashboard(@CurrentUser() user: { email: string; roles: string[] }) {
    return {
      message: `Welcome to the admin dashboard, ${user.email}`,
      roles: user.roles,
    };
  }
}
