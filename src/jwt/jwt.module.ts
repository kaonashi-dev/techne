import { Module } from "../decorators/module.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtService, type JwtModuleOptions } from "./jwt.service";
import { JWT_MODULE_OPTIONS } from "./tokens";

export interface JwtModuleAsyncOptions {
  inject?: any[];
  useFactory: (...args: any[]) => JwtModuleOptions;
}

function createDynamicModule(metadata: { providers: any[]; exports: any[] }): any {
  class DynamicJwtModule {}
  Module({
    providers: metadata.providers,
    exports: metadata.exports,
  })(DynamicJwtModule);
  return DynamicJwtModule;
}

export class JwtModule {
  static register(options: JwtModuleOptions): any {
    return createDynamicModule({
      providers: [{ provide: JWT_MODULE_OPTIONS, useValue: options }, JwtService, JwtAuthGuard],
      exports: [JWT_MODULE_OPTIONS, JwtService, JwtAuthGuard],
    });
  }

  static registerAsync(options: JwtModuleAsyncOptions): any {
    return createDynamicModule({
      providers: [
        {
          provide: JWT_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject,
        },
        JwtService,
        JwtAuthGuard,
      ],
      exports: [JWT_MODULE_OPTIONS, JwtService, JwtAuthGuard],
    });
  }
}
