import { definePlugin } from "../core/plugins/define-plugin";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService, type JwtModuleOptions } from "./jwt.service";
import { JWT_MODULE_OPTIONS } from "./tokens";

/**
 * Plugin-style JWT registration. Use with
 * `TechneFactory.create({ plugins: [jwt({ secret: "..." })] })`.
 */
export function jwt(options: JwtModuleOptions) {
  return definePlugin({
    name: "jwt",
    setup(ctx) {
      ctx.provide(JWT_MODULE_OPTIONS, options);
      ctx.registerProviders([JwtService, JwtAuthGuard]);
    },
  });
}
