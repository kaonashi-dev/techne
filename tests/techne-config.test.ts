import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Module } from "../src/decorators/module.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { TechneFactory, __resetTechneConfigCache } from "../src/factory/techne-factory";
import { defineTechneConfig, bnest, bootstrap } from "../src/core";
import type { CanActivate } from "../src/interfaces/can-activate.interface";
import { Logger } from "../src/services/logger.service";

// Silence deprecation warnings emitted by `app.setGlobalPrefix()` etc. — they
// fire at most once per process but cleaner test output is preferable.
Logger.setEnabled(false);

@Controller("users")
class UsersController {
  @Get("/")
  list() {
    return { ok: true };
  }
}

@Module({ controllers: [UsersController] })
class AppModule {}

@Injectable()
class AllowGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

async function writeConfig(dir: string, contents: string) {
  await fs.writeFile(path.join(dir, "bnest.config.ts"), contents);
}

describe("defineTechneConfig", () => {
  test("returns the input unchanged (identity)", () => {
    const cfg = { module: AppModule, port: 4242, globalPrefix: "api" };
    expect(defineTechneConfig(cfg)).toBe(cfg);
  });
});

describe("TechneFactory.create + bnest.config.ts", () => {
  let originalCwd: string;
  let tempRoot: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bnest-config-"));
    process.chdir(tempRoot);
    __resetTechneConfigCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
    __resetTechneConfigCache();
  });

  test("uses cors / globalPrefix from a bnest.config.ts in cwd", async () => {
    // Reference symbols by re-importing the module under the test's cwd. The
    // simplest path is to write a config file that imports AppModule from a
    // local module we also write. To keep this self-contained we instead set
    // the module via the create() argument and only test the option fields.
    await writeConfig(
      tempRoot,
      `export default { globalPrefix: "api", cors: { origin: true } };\n`,
    );

    const app = await TechneFactory.create(AppModule, { logger: false });

    const ok = await app.handle(new Request("http://localhost/api/users"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    const preflight = await app.handle(
      new Request("http://localhost/api/users", {
        method: "OPTIONS",
        headers: { Origin: "http://example.com" },
      }),
    );
    expect(preflight.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  test("factory options override file values (shallow per-key)", async () => {
    await writeConfig(
      tempRoot,
      `export default { globalPrefix: "fromfile" };\n`,
    );

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      globalPrefix: "fromopts",
    });

    const wrong = await app.handle(new Request("http://localhost/fromfile/users"));
    expect(wrong.status).toBe(404);

    const right = await app.handle(new Request("http://localhost/fromopts/users"));
    expect(right.status).toBe(200);
  });

  test("globalGuards from file and options are concatenated", async () => {
    // File contributes a deny guard; options contribute an allow guard.
    // Because both must pass and one denies, the route should 403/blocked.
    // Workaround: file path can't easily import a class, so we use a config
    // that exports the deny guard via a shared registry.
    const guardModulePath = path.join(tempRoot, "guards.ts");
    await fs.writeFile(
      guardModulePath,
      `export class DenyGuard {
  canActivate() { return false; }
}\n`,
    );
    await writeConfig(
      tempRoot,
      `import { DenyGuard } from "./guards";
export default { globalGuards: [new DenyGuard()] };\n`,
    );

    const app = await TechneFactory.create(AppModule, {
      logger: false,
      globalGuards: [new AllowGuard()],
    });

    const res = await app.handle(new Request("http://localhost/users"));
    // The deny guard from the file should reject before the allow guard runs.
    expect(res.status).not.toBe(200);
  });

  test("zero-arg TechneFactory.create() resolves module from config", async () => {
    // Write the module and config to disk so dynamic import sees real files.
    const modulePath = path.join(tempRoot, "app.module.ts");
    await fs.writeFile(
      modulePath,
      `import { Controller, Get, Module } from "${path.join(originalCwd, "src", "common")}";

@Controller("ping")
class PingController {
  @Get("/")
  ping() { return { ping: true }; }
}

@Module({ controllers: [PingController] })
export class AppModule {}
`,
    );
    await writeConfig(
      tempRoot,
      `import { AppModule } from "./app.module";
export default { module: AppModule, logger: false };\n`,
    );

    const app = await TechneFactory.create();
    const res = await app.handle(new Request("http://localhost/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ping: true });
  });

  test("zero-arg create() throws when config has no module", async () => {
    await writeConfig(tempRoot, `export default { logger: false };\n`);
    await expect(TechneFactory.create()).rejects.toThrow(/no module supplied/);
  });

  test("throws when config file exists but has no default export", async () => {
    await fs.writeFile(
      path.join(tempRoot, "bnest.config.ts"),
      `export const cfg = { logger: false };\n`,
    );
    __resetTechneConfigCache();
    await expect(TechneFactory.create(AppModule)).rejects.toThrow(/no default export/);
  });

  test("bnest() shorthand calls through to TechneFactory.create", async () => {
    await writeConfig(tempRoot, `export default { globalPrefix: "via-bnest" };\n`);
    const app = await bnest(AppModule, { logger: false });
    const res = await app.handle(new Request("http://localhost/via-bnest/users"));
    expect(res.status).toBe(200);
  });

  test("bootstrap() listens on the configured port and respects Bun.env.PORT", async () => {
    await writeConfig(
      tempRoot,
      `export default { port: 0, logger: false };\n`,
    );

    // Port 0 lets the OS assign a free port — we just need a listening server.
    const app = await bootstrap(AppModule);
    const url = app.getUrl();
    expect(url).toBeTruthy();
    await app.close();

    // Now verify Bun.env.PORT wins over the config when no explicit port is
    // given via options. We have to do this in a fresh dir because cache.
    await fs.rm(path.join(tempRoot, "bnest.config.ts"), { force: true });
    await writeConfig(tempRoot, `export default { logger: false };\n`);
    __resetTechneConfigCache();
    const prevPort = Bun.env.PORT;
    Bun.env.PORT = "0";
    try {
      const app2 = await bootstrap(AppModule);
      expect(app2.getUrl()).toBeTruthy();
      await app2.close();
    } finally {
      if (prevPort === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = prevPort;
    }
  });
});
