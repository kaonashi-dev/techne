/**
 * Lightweight metadata store — replaces the `reflect-metadata` package.
 *
 * TypeScript emits `Reflect.metadata("design:paramtypes", [...])` calls when
 * `emitDecoratorMetadata: true`.  We patch the global `Reflect` object in
 * `src/reflect-setup.ts` so those emitted calls write into this WeakMap.
 * All framework decorators call these functions directly.
 */
import type { ParamMetadata } from "../decorators/params.decorator";
import type { RouteMetadata } from "../decorators/routes.decorator";

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
  return _store.get(target)?.get(key)?.get(propertyKey) as T | undefined;
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

// ---------------------------------------------------------------------------
// Symbol-keyed `ControllerDescriptor` — single-pass metadata access at boot.
// ---------------------------------------------------------------------------
//
// Decorators populate this descriptor in addition to (legacy) `defineMetadata`
// calls so `RouterExplorer.explore()` can read everything it needs in a single
// property access instead of doing 9 per-controller + 6 per-handler two-level
// Map walks.  Multiple decorators on the same class MERGE into one descriptor.

/** Per-handler metadata captured by method-level decorators. */
export interface HandlerDescriptor {
  /** Middlewares applied directly to this handler via `@Use`/`@Middleware`. */
  middlewares: any[];
  /** Guards from `@UseGuards` on the method. */
  guards: any[];
  /** Exception filters from `@UseFilters` on the method. */
  filters: any[];
  /** Response hooks from `@OnResponse` on the method. */
  responseHooks: any[];
  /** Versions from `@Version` on the method (overrides the controller). */
  versions?: string[];
}

/** Aggregate metadata for a controller class, populated as decorators run. */
export interface ControllerDescriptor {
  /** Path prefix from `@Controller(path)`. `undefined` if `@Controller` has not run. */
  prefix?: string;
  /** Versions from `@Version` on the class. */
  versions?: string[];
  /** Routes registered by `@Get`/`@Post`/etc. */
  routes: RouteMetadata[];
  /** Class-level middlewares from `@Use`/`@Middleware`. */
  middlewares: any[];
  /** Class-level guards from `@UseGuards`. */
  guards: any[];
  /** Class-level filters from `@UseFilters`. */
  filters: any[];
  /** Class-level response hooks from `@OnResponse`. */
  responseHooks: any[];
  /** Parameter metadata captured by `@Body`/`@Param`/etc., keyed by handler name. */
  paramsByHandler: Record<string, ParamMetadata[]>;
  /** Per-handler descriptors keyed by handler name. */
  handlers: Record<string, HandlerDescriptor>;
}

/** Symbol the controller class carries pointing at its descriptor. */
export const CONTROLLER_DESCRIPTOR: unique symbol = Symbol.for("techne:controller-descriptor");

interface ControllerWithDescriptor {
  [CONTROLLER_DESCRIPTOR]?: ControllerDescriptor;
}

/**
 * Return the (lazily created) `ControllerDescriptor` attached to `target`.
 * `target` is expected to be a class constructor.
 */
export function getOrCreateControllerDescriptor(target: object): ControllerDescriptor {
  const holder = target as ControllerWithDescriptor;
  let descriptor = holder[CONTROLLER_DESCRIPTOR];
  if (!descriptor) {
    descriptor = {
      routes: [],
      middlewares: [],
      guards: [],
      filters: [],
      responseHooks: [],
      paramsByHandler: {},
      handlers: {},
    };
    Object.defineProperty(holder, CONTROLLER_DESCRIPTOR, {
      value: descriptor,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
  return descriptor;
}

/** Read the descriptor without creating one. */
export function getControllerDescriptor(target: object): ControllerDescriptor | undefined {
  return (target as ControllerWithDescriptor)[CONTROLLER_DESCRIPTOR];
}

/** Return the (lazily created) `HandlerDescriptor` for `handlerName` on `target`. */
export function getOrCreateHandlerDescriptor(
  target: object,
  handlerName: string,
): HandlerDescriptor {
  const controller = getOrCreateControllerDescriptor(target);
  let handler = controller.handlers[handlerName];
  if (!handler) {
    handler = {
      middlewares: [],
      guards: [],
      filters: [],
      responseHooks: [],
    };
    controller.handlers[handlerName] = handler;
  }
  return handler;
}
