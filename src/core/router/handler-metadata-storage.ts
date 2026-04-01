export class HandlerMetadataStorage<T> {
  private readonly cache = new WeakMap<object, Map<string, T>>();

  public get(instance: object, methodName: string): T | undefined {
    return this.cache.get(instance)?.get(methodName);
  }

  public set(instance: object, methodName: string, metadata: T): void {
    const instanceCache = this.cache.get(instance);
    if (instanceCache) {
      instanceCache.set(methodName, metadata);
      return;
    }

    this.cache.set(instance, new Map([[methodName, metadata]]));
  }
}
