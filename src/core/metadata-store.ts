/**
 * Lightweight metadata store — replaces the `reflect-metadata` package.
 *
 * TypeScript emits `Reflect.metadata("design:paramtypes", [...])` calls when
 * `emitDecoratorMetadata: true`.  We patch the global `Reflect` object in
 * `src/reflect-setup.ts` so those emitted calls write into this WeakMap.
 * All framework decorators call these functions directly.
 */
type MetadataKey = string | symbol;
type PropertyMetadataStore = Map<MetadataKey | undefined, any>;

const _store = new WeakMap<object, Map<MetadataKey, PropertyMetadataStore>>();

function _getMap(target: object): Map<MetadataKey, PropertyMetadataStore> {
  let map = _store.get(target);
  if (!map) {
    map = new Map();
    _store.set(target, map);
  }
  return map;
}

function _getPropertyMap(
  target: object,
  key: MetadataKey,
  propertyKey?: MetadataKey,
): PropertyMetadataStore {
  const map = _getMap(target);
  let propertyMap = map.get(key);
  if (!propertyMap) {
    propertyMap = new Map();
    map.set(key, propertyMap);
  }
  if (!propertyMap.has(propertyKey)) {
    propertyMap.set(propertyKey, undefined);
  }
  return propertyMap;
}

/** Store `value` under `key` on `target`. */
export function defineMetadata(
  key: MetadataKey,
  value: any,
  target: object,
  propertyKey?: MetadataKey,
): void {
  _getPropertyMap(target, key, propertyKey).set(propertyKey, value);
}

/** Retrieve the value stored under `key` on `target`, or `undefined`. */
export function getMetadata<T = any>(
  key: MetadataKey,
  target: object,
  propertyKey?: MetadataKey,
): T | undefined {
  return _getMap(target).get(key)?.get(propertyKey) as T | undefined;
}

/**
 * Returns a class decorator that stores `value` under `key`.
 * TypeScript emits `Reflect.metadata(key, value)` — this is the handler.
 */
export function metadata(
  key: MetadataKey,
  value: any,
): (target: object, propertyKey?: MetadataKey) => void {
  return (target: object, propertyKey?: MetadataKey) => {
    defineMetadata(key, value, target, propertyKey);
  };
}
