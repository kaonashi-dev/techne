export class ContextIdFactory {
  private static readonly requestIds = new WeakMap<object, symbol>();

  static create(): symbol {
    return Symbol("bnest:context");
  }

  static getByRequest<T extends object>(request: T): symbol {
    const existing = this.requestIds.get(request);
    if (existing) {
      return existing;
    }

    const contextId = this.create();
    this.requestIds.set(request, contextId);
    return contextId;
  }

  static clear(request: object): void {
    this.requestIds.delete(request);
  }
}
