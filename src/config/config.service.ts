import { Inject } from "../decorators/inject.decorator";
import { Injectable } from "../decorators/injectable.decorator";
import { CONFIG_STORE } from "./tokens";

const pathSegmentsCache = new Map<string, string[]>();

function getPathSegments(path: string): string[] {
  const cached = pathSegmentsCache.get(path);
  if (cached) {
    return cached;
  }

  const segments = path.split(".");
  pathSegmentsCache.set(path, segments);
  return segments;
}

function getValue(obj: Record<string, any>, path: string): unknown {
  return getPathSegments(path).reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

@Injectable()
export class ConfigService {
  constructor(@Inject(CONFIG_STORE) private readonly store: Record<string, any>) {}

  get<T = string>(key: string, defaultValue?: T): T | undefined {
    const value = getValue(this.store, key);
    return (value === undefined ? defaultValue : value) as T | undefined;
  }

  getOrThrow<T = string>(key: string): T {
    const value = this.get<T>(key);
    if (value === undefined) {
      throw new Error(`Missing configuration value for "${key}"`);
    }
    return value;
  }

  getStore(): Readonly<Record<string, any>> {
    return this.store;
  }
}
