import { describe, expect, test } from "bun:test";
import { APP_GUARD, Req } from "../src/common";
import { Controller } from "../src/decorators/controller.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { Injectable } from "../src/decorators/injectable.decorator";
import { Module } from "../src/decorators/module.decorator";
import { BnestFactory } from "../src/factory/bnest-factory";
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

    @Module({ providers: [UsersService, AppService] })
    class AppModule {}

    const app = await BnestFactory.createApplicationContext(AppModule, { logger: false });
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

    @Module({ providers: [TransientService, ConsumerService] })
    class AppModule {}

    const app = await BnestFactory.createApplicationContext(AppModule, { logger: false });
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

    @Module({ controllers: [ScopedController], providers: [RequestIdService] })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const first = await app.handle(new Request("http://localhost/scoped")).then((r) => r.json());
    const second = await app.handle(new Request("http://localhost/scoped")).then((r) => r.json());

    expect(first.id).toBeDefined();
    expect(second.id).toBeDefined();
    expect(first.id).not.toBe(second.id);
  });

  test("enforces module exports when resolving from the application context", async () => {
    @Injectable()
    class PrivateService {
      getValue() {
        return "private";
      }
    }

    @Module({
      providers: [PrivateService],
    })
    class FeatureModule {}

    @Module({
      imports: [FeatureModule],
    })
    class AppModule {}

    const app = await BnestFactory.createApplicationContext(AppModule, { logger: false });

    expect(() => app.get<PrivateService>(PrivateService)).toThrow(
      "Provider PrivateService is not visible inside module AppModule.",
    );

    await app.close();
  });

  test("makes global module exports visible without explicit imports", async () => {
    @Injectable()
    class ConfigService {
      getName() {
        return "bnest";
      }
    }

    @Module({
      global: true,
      providers: [ConfigService],
      exports: [ConfigService],
    })
    class ConfigModule {}

    @Injectable()
    class ConsumerService {
      constructor(public readonly config: ConfigService) {}
    }

    @Module({
      providers: [ConsumerService],
      exports: [ConsumerService],
    })
    class ConsumerModule {}

    @Module({
      imports: [ConfigModule, ConsumerModule],
    })
    class AppModule {}

    const app = await BnestFactory.createApplicationContext(AppModule, { logger: false });

    expect(app.get<ConsumerService>(ConsumerService).config.getName()).toBe("bnest");

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
        const request = context.switchToHttp().getRequest() as Record<string, unknown>;
        (request.request as Record<string, unknown>).guardStateId = this.state.id;
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

    @Module({
      controllers: [StateController],
      providers: [
        RequestStateService,
        RequestStateGuard,
        {
          provide: APP_GUARD,
          useClass: RequestStateGuard,
        },
      ],
    })
    class AppModule {}

    const app = await BnestFactory.create(AppModule, { logger: false });
    const first = await app.handle(new Request("http://localhost/state")).then((r) => r.json());
    const second = await app.handle(new Request("http://localhost/state")).then((r) => r.json());

    expect(first.guardStateId).toBe(first.controllerStateId);
    expect(second.guardStateId).toBe(second.controllerStateId);
    expect(first.controllerStateId).not.toBe(second.controllerStateId);
  });
});
