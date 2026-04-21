export interface ConfigFactory<T = Record<string, any>> {
  (): T;
  KEY?: string;
}

export function registerAs<T = Record<string, any>>(namespace: string, factory: () => T) {
  return Object.assign(factory, { KEY: namespace }) as ConfigFactory<T>;
}
