import { describe, expect, test } from "bun:test";
import { APP_GUARD, Public, Req, Roles, RolesGuard } from "../src/common";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { JwtAuthGuard, JwtService, jwt as jwtPlugin } from "../src/jwt";
import { Reflector } from "../src/core/reflector";
describe("JWT auth", () => {
  test("supports public routes, JWT auth and role-based authorization", async () => {
    @Controller("auth")
    class AuthController {
      @Public()
      @Get("/public")
      publicRoute() {
        return { public: true };
      }
      @Get("/profile")
      profile(
        @Req()
        req: any,
      ) {
        return { sub: req.user.sub };
      }
      @Roles("admin")
      @Get("/admin")
      admin(
        @Req()
        req: any,
      ) {
        return { role: req.user.roles[0] };
      }
    }
    const app = await TechneFactory.create({
      plugins: [jwtPlugin({ secret: "top-secret" })],
      controllers: [AuthController],
      providers: [
        {
          provide: APP_GUARD,
          useFactory: (jwt: JwtService, reflector: Reflector) => [
            new JwtAuthGuard(reflector, jwt),
            new RolesGuard(reflector),
          ],
          inject: [JwtService, Reflector],
        },
      ],
      logger: false,
    });
    const jwt = app.get<JwtService>(JwtService);
    const adminToken = await jwt.signAsync({ sub: "123", roles: ["admin"] });
    const userToken = await jwt.signAsync({ sub: "456", roles: ["user"] });
    const publicResponse = await app.handle(new Request("http://localhost/auth/public"));
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toEqual({ public: true });
    const unauthorized = await app.handle(new Request("http://localhost/auth/profile"));
    expect(unauthorized.status).toBe(401);
    const profile = await app.handle(
      new Request("http://localhost/auth/profile", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({ sub: "123" });
    const forbidden = await app.handle(
      new Request("http://localhost/auth/admin", {
        headers: { authorization: `Bearer ${userToken}` },
      }),
    );
    expect(forbidden.status).toBe(403);
    const admin = await app.handle(
      new Request("http://localhost/auth/admin", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(admin.status).toBe(200);
    expect(await admin.json()).toEqual({ role: "admin" });
  });
});
