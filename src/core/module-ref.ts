import type { Container, ResolutionContext } from "./container";

export class ModuleRef {
  constructor(
    private readonly container: Container,
    private readonly module?: any,
  ) {}

  get<T>(token: any): T {
    return this.container.get<T>(token, this.module ? { module: this.module } : undefined);
  }

  resolve<T>(token: any, context?: ResolutionContext): T {
    return this.container.resolve<T>(token, {
      ...(this.module ? { module: this.module } : {}),
      ...context,
    });
  }

  createContextId(): symbol {
    return this.container.createContextId();
  }

  introspect() {
    return {
      module: this.module,
    };
  }
}
