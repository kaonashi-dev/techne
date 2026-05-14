import type { Container, ResolutionContext } from "./container";

export class ModuleRef {
  constructor(private readonly container: Container) {}

  get<T>(token: any): T {
    return this.container.get<T>(token);
  }

  resolve<T>(token: any, context?: ResolutionContext): T {
    return this.container.resolve<T>(token, context);
  }

  createContextId(): symbol {
    return this.container.createContextId();
  }
}
