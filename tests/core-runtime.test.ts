import { describe, expect, test } from "bun:test";
import { APP_GUARD, Req } from "../src/common";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
import { ModuleRef } from "../src/core/module-ref";
import { Scope } from "../src/core/scope";
import type { CanActivate } from "../src/interfaces/can-activate.interface";

describe("core runtime", () => {
  test("createApplicationContext exposes ModuleRef and resolves providers", async () => {
    @Injectable()
    class UsersService {
      getName() {
        return "Ada";
      }
    }

    @Injectable()
    class AppService {
      constructor(public readonly moduleRef: ModuleRef) {}
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [UsersService, AppService],
      logger: false,
    });
    const moduleRef = app.get<ModuleRef>(ModuleRef);

    expect(moduleRef.get<UsersService>(UsersService).getName()).toBe("Ada");
    expect(app.get<AppService>(AppService).moduleRef).toBeInstanceOf(ModuleRef);

    await app.close();
  });

  test("transient providers resolve to new instances within the same graph", async () => {
    @Injectable({ scope: Scope.TRANSIENT })
    class TransientService {
      readonly id = Math.random();
    }

    @Injectable()
    class ConsumerService {
      constructor(
        public readonly first: TransientService,
        public readonly second: TransientService,
      ) {}
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [TransientService, ConsumerService],
      logger: false,
    });
    const consumer = app.get<ConsumerService>(ConsumerService);

    expect(consumer.first).not.toBe(consumer.second);

    await app.close();
  });

  test("request-scoped controllers resolve per request", async () => {
    @Injectable({ scope: Scope.REQUEST })
    class RequestIdService {
      readonly id = Math.random().toString(36).slice(2);
    }

    @Controller({ path: "scoped", scope: Scope.REQUEST })
    class ScopedController {
      constructor(private readonly requestId: RequestIdService) {}

      @Get("/")
      getId() {
        return { id: this.requestId.id };
      }
    }

    const app = await TechneFactory.create({
      controllers: [ScopedController],
      providers: [RequestIdService],
      logger: false,
    });
    const first = await app.handle(new Request("http://localhost/scoped")).then((r) => r.json());
    const second = await app.handle(new Request("http://localhost/scoped")).then((r) => r.json());

    expect(first.id).toBeDefined();
    expect(second.id).toBeDefined();
    expect(first.id).not.toBe(second.id);
  });

  test("all providers are globally visible in the flat container", async () => {
    @Injectable()
    class ConfigService {
      getName() {
        return "techne";
      }
    }

    @Injectable()
    class ConsumerService {
      constructor(public readonly config: ConfigService) {}
    }

    const app = await TechneFactory.createApplicationContext({
      providers: [ConfigService, ConsumerService],
      logger: false,
    });

    expect(app.get<ConsumerService>(ConsumerService).config.getName()).toBe("techne");

    await app.close();
  });

  test("shares the same request-scoped instance across guards and handlers", async () => {
    @Injectable({ scope: Scope.REQUEST })
    class RequestStateService {
      readonly id = Math.random().toString(36).slice(2);
    }

    @Injectable()
    class RequestStateGuard implements CanActivate {
      constructor(private readonly state: RequestStateService) {}

      canActivate(context: any) {
        (context.ctx.request as Record<string, unknown>).guardStateId = this.state.id;
        return true;
      }
    }

    @Controller("state")
    class StateController {
      constructor(private readonly state: RequestStateService) {}

      @Get("/")
      getState(@Req() request: Record<string, unknown>) {
        return {
          controllerStateId: this.state.id,
          guardStateId: request.guardStateId,
        };
      }
    }

    const app = await TechneFactory.create({
      controllers: [StateController],
      providers: [
        RequestStateService,
        RequestStateGuard,
        {
          provide: APP_GUARD,
          useClass: RequestStateGuard,
        },
      ],
      logger: false,
    });
    const first = await app.handle(new Request("http://localhost/state")).then((r) => r.json());
    const second = await app.handle(new Request("http://localhost/state")).then((r) => r.json());

    expect(first.guardStateId).toBe(first.controllerStateId);
    expect(second.guardStateId).toBe(second.controllerStateId);
    expect(first.controllerStateId).not.toBe(second.controllerStateId);
  });
});
