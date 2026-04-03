/**
 * Lightweight metadata store — replaces the `reflect-metadata` package.
 *
 * TypeScript emits `Reflect.metadata("design:paramtypes", [...])` calls when
 * `emitDecoratorMetadata: true`.  We patch the global `Reflect` object in
 * `src/reflect-setup.ts` so those emitted calls write into this WeakMap.
 * All framework decorators call these functions directly.
 */
const _store = new WeakMap<object, Map<string | symbol, any>>();

function _getMap(target: object): Map<string | symbol, any> {
  let map = _store.get(target);
  if (!map) {
    map = new Map();
    _store.set(target, map);
  }
  return map;
}

/** Store `value` under `key` on `target`. */
export function defineMetadata(key: string | symbol, value: any, target: object): void {
  _getMap(target).set(key, value);
}

/** Retrieve the value stored under `key` on `target`, or `undefined`. */
export function getMetadata<T = any>(key: string | symbol, target: object): T | undefined {
  return _getMap(target).get(key) as T | undefined;
}

/**
 * Returns a class decorator that stores `value` under `key`.
 * TypeScript emits `Reflect.metadata(key, value)` — this is the handler.
 */
export function metadata(
  key: string | symbol,
  value: any,
): (target: object) => void {
  return (target: object) => {
    defineMetadata(key, value, target);
  };
}
