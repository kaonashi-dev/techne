import { describe, expect, test } from "bun:test";
import { RolesGuard } from "../src/auth/roles.guard";
import { Reflector } from "../src/core/reflector";
import { Roles } from "../src/decorators/roles.decorator";

/**
 * RolesGuard is constructed directly with a real Reflector. The guard reads
 * `context.handler` and `context.controller` (the raw fields the framework
 * passes — not `getHandler()`/`getClass()`) and pulls the user roles off
 * `context.ctx.request.user.roles`.
 */
describe("RolesGuard (unit)", () => {
  function makeContext(handler: Function, controller: Function, user?: unknown) {
    return {
      handler,
      controller,
      ctx: {
        request: { user },
      },
    };
  }

  test("allows when handler has no @Roles metadata", () => {
    class Controller {}
    function handler() {}

    const guard = new RolesGuard(new Reflector());
    const allowed = guard.canActivate(makeContext(handler, Controller, { roles: ["user"] }));
    expect(allowed).toBe(true);
  });

  test("allows when user has a matching role", () => {
    class Controller {}
    class Holder {
      @Roles("admin")
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    const allowed = guard.canActivate(
      makeContext(handler, Controller, { sub: "u1", roles: ["admin", "user"] }),
    );
    expect(allowed).toBe(true);
  });

  test("denies when user has no matching role", () => {
    class Controller {}
    class Holder {
      @Roles("admin")
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    const allowed = guard.canActivate(
      makeContext(handler, Controller, { sub: "u2", roles: ["user"] }),
    );
    expect(allowed).toBe(false);
  });

  test("denies gracefully when user is missing entirely", () => {
    class Controller {}
    class Holder {
      @Roles("admin")
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    // user undefined — guard reads `request?.user?.roles`, falls back to []
    expect(guard.canActivate(makeContext(handler, Controller, undefined))).toBe(false);
  });

  test("denies gracefully when user has no roles array", () => {
    class Controller {}
    class Holder {
      @Roles("admin")
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    // user.roles is not an array — guard normalizes to []
    expect(
      guard.canActivate(makeContext(handler, Controller, { sub: "u3", roles: "admin" })),
    ).toBe(false);
    expect(guard.canActivate(makeContext(handler, Controller, { sub: "u4" }))).toBe(false);
  });

  test("handler @Roles overrides controller @Roles (Techne convention: [handler, controller])", () => {
    @Roles("admin")
    class Controller {}
    class Holder {
      @Roles("user")
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    // handler requires "user" — admin-only caller should be rejected because
    // the handler-level metadata wins.
    expect(guard.canActivate(makeContext(handler, Controller, { roles: ["admin"] }))).toBe(false);
    expect(guard.canActivate(makeContext(handler, Controller, { roles: ["user"] }))).toBe(true);
  });

  test("allows when @Roles is declared with an empty role list", () => {
    class Controller {}
    class Holder {
      @Roles()
      handler() {}
    }
    const handler = Holder.prototype.handler;

    const guard = new RolesGuard(new Reflector());
    // Empty role list means no roles required; guard short-circuits to allow.
    expect(guard.canActivate(makeContext(handler, Controller, { roles: [] }))).toBe(true);
  });
});
