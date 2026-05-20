import { describe, expect, test } from "bun:test";
import {
  definePlugin,
  type PluginDefinition,
} from "../src/core/plugins/define-plugin";

/**
 * `definePlugin` is intentionally an identity helper — its only job is to
 * carry the `TOptions` generic through to the call site for inference. The
 * actual registration / shape validation happens in
 * `TechneApplication.register()` (covered by `plugin-protocol.test.ts`).
 */
describe("definePlugin", () => {
  test("returns the same object reference passed in", () => {
    const def: PluginDefinition = {
      name: "noop",
      setup() {},
    };
    expect(definePlugin(def)).toBe(def);
  });

  test("preserves all optional fields verbatim", () => {
    const setup = () => {};
    const def = definePlugin({
      name: "with-meta",
      version: "1.2.3",
      dependencies: ["other-plugin"],
      ready: "before-listen",
      setup,
    });
    expect(def.name).toBe("with-meta");
    expect(def.version).toBe("1.2.3");
    expect(def.dependencies).toEqual(["other-plugin"]);
    expect(def.ready).toBe("before-listen");
    expect(def.setup).toBe(setup);
  });

  test("does not validate or freeze the definition (validation is deferred to register())", () => {
    // Intentionally crafting a definition that would be invalid at register-time
    // (missing `setup`); definePlugin still passes it through unchanged, because
    // it's purely a typing helper.
    const incomplete = { name: "no-setup" } as unknown as PluginDefinition;
    const returned = definePlugin(incomplete);
    expect(returned).toBe(incomplete);
    expect(Object.isFrozen(returned)).toBe(false);
  });

  test("infers TOptions so setup receives the typed second argument", () => {
    interface Opts {
      header: string;
      maxAge?: number;
    }
    let captured: Opts | undefined;
    const plugin = definePlugin<Opts>({
      name: "typed",
      setup(_ctx, options) {
        captured = options;
      },
    });
    // Manually invoke setup with a stub context to exercise the typed call.
    plugin.setup({} as any, { header: "x-trace", maxAge: 60 });
    expect(captured).toEqual({ header: "x-trace", maxAge: 60 });
  });
});
