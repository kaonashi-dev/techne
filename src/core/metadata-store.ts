/**
 * Lightweight metadata store — replaces the `reflect-metadata` package.
 *
 * TypeScript emits `Reflect.metadata("design:paramtypes", [...])` calls when
 * `emitDecoratorMetadata: true`. We patch the global `Reflect` object in
 * `src/reflect-setup.ts` so those emitted calls write to
 * `target[Symbol.metadata]` by default, with the old WeakMap store retained
 * behind `TECHNE_LEGACY_DECORATORS=1`.
 */
import type { ParamMetadata } from "../decorators/params.decorator";
import type { RouteMetadata } from "../decorators/routes.decorator";

type MetadataKey = string | symbol;
type PropertyMetadataStore = Map<MetadataKey | undefined, any>;

const LEGACY_DECORATORS = process.env.TECHNE_LEGACY_DECORATORS === "1";
const SYMBOL_METADATA: symbol = (() => {
  const existing = (Symbol as any).metadata;
  if (existing) return existing;
  const polyfill = Symbol.for("Symbol.metadata");
  Object.defineProperty(Symbol, "metadata", {
    value: polyfill,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return polyfill;
})();
const REFLECT_METADATA = Symbol.for("techne:reflect-metadata");
const CLASS_METADATA_SLOT = Symbol.for("techne:metadata:class");
export const TECHNE_METADATA_KEY = "techne";

export interface TechneSymbolMetadata {
  controller?: ControllerDescriptor;
}

export interface DecoratorContextLike {
  kind: string;
  name?: string | symbol;
  metadata?: object;
}

interface SymbolMetadataRoot {
  [REFLECT_METADATA]?: Record<PropertyKey, Record<MetadataKey, any>>;
  [TECHNE_METADATA_KEY]?: TechneSymbolMetadata;
}

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
  if (!LEGACY_DECORATORS) {
    getSymbolMetadataBucket(target, propertyKey, true)![key] = value;
    return;
  }

  _getPropertyMap(target, key, propertyKey).set(propertyKey, value);
}

/** Retrieve the value stored under `key` on `target`, or `undefined`. */
export function getMetadata<T = any>(
  key: MetadataKey,
  target: object,
  propertyKey?: MetadataKey,
): T | undefined {
  const bucket = getSymbolMetadataBucket(target, propertyKey, false);
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
    return bucket[key] as T;
  }
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

function getSymbolMetadataRoot(target: object, create: boolean): SymbolMetadataRoot | undefined {
  const holder = target as any;
  let root = holder[SYMBOL_METADATA] as SymbolMetadataRoot | undefined;
  if (!root && !create) return undefined;

  if (!root) {
    root = Object.create(null) as SymbolMetadataRoot;
    Object.defineProperty(holder, SYMBOL_METADATA, {
      value: root,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    return root;
  }

  if (create && !Object.prototype.hasOwnProperty.call(holder, SYMBOL_METADATA)) {
    root = Object.create(root) as SymbolMetadataRoot;
    Object.defineProperty(holder, SYMBOL_METADATA, {
      value: root,
      writable: true,
      enumerable: false,
      configurable: true,
    });
  }

  return root;
}

function getSymbolMetadataBucket(
  target: object,
  propertyKey: MetadataKey | undefined,
  create: boolean,
): Record<MetadataKey, any> | undefined {
  const root = getSymbolMetadataRoot(target, create);
  if (!root) return undefined;
  return getSymbolMetadataBucketFromRoot(root, propertyKey, create);
}

function getSymbolMetadataBucketFromRoot(
  root: SymbolMetadataRoot,
  propertyKey: MetadataKey | undefined,
  create: boolean,
): Record<MetadataKey, any> | undefined {
  let reflectStore = root[REFLECT_METADATA];
  if (!reflectStore) {
    if (!create) return undefined;
    reflectStore = Object.create(null) as Record<PropertyKey, Record<MetadataKey, any>>;
    root[REFLECT_METADATA] = reflectStore;
  }

  const slot = propertyKey ?? CLASS_METADATA_SLOT;
  let bucket = reflectStore[slot];
  if (!bucket) {
    if (!create) return undefined;
    bucket = Object.create(null) as Record<MetadataKey, any>;
    reflectStore[slot] = bucket;
  }
  return bucket;
}

export function defineMetadataFromContext(
  metadata: object,
  key: MetadataKey,
  value: any,
  propertyKey?: MetadataKey,
): void {
  getSymbolMetadataBucketFromRoot(metadata as SymbolMetadataRoot, propertyKey, true)![key] = value;
}

export function getMetadataFromContext<T = any>(
  metadata: object,
  key: MetadataKey,
  propertyKey?: MetadataKey,
): T | undefined {
  const bucket = getSymbolMetadataBucketFromRoot(
    metadata as SymbolMetadataRoot,
    propertyKey,
    false,
  );
  if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
    return bucket[key] as T;
  }
  return undefined;
}

export function getOrCreateTechneMetadata(target: object): TechneSymbolMetadata {
  const root = getSymbolMetadataRoot(target, true)!;
  let metadata = root[TECHNE_METADATA_KEY];
  if (!metadata) {
    metadata = {};
    root[TECHNE_METADATA_KEY] = metadata;
  }
  return metadata;
}

export function getTechneMetadata(target: object): TechneSymbolMetadata | undefined {
  return getSymbolMetadataRoot(target, false)?.[TECHNE_METADATA_KEY];
}

export function getOrCreateTechneMetadataFromContext(metadata: object): TechneSymbolMetadata {
  const root = metadata as SymbolMetadataRoot;
  let techne = root[TECHNE_METADATA_KEY];
  if (!techne) {
    techne = {};
    root[TECHNE_METADATA_KEY] = techne;
  }
  return techne;
}

export function isDecoratorContext(value: unknown): value is DecoratorContextLike {
  return !!value && typeof value === "object" && typeof (value as any).kind === "string";
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

function createControllerDescriptor(): ControllerDescriptor {
  return {
    routes: [],
    middlewares: [],
    guards: [],
    filters: [],
    responseHooks: [],
    paramsByHandler: {},
    handlers: {},
  };
}

function attachLegacyDescriptor(target: object, descriptor: ControllerDescriptor): void {
  const holder = target as ControllerWithDescriptor;
  if (holder[CONTROLLER_DESCRIPTOR]) return;
  Object.defineProperty(holder, CONTROLLER_DESCRIPTOR, {
    value: descriptor,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/**
 * Return the (lazily created) `ControllerDescriptor` attached to `target`.
 * `target` is expected to be a class constructor.
 */
export function getOrCreateControllerDescriptor(target: object): ControllerDescriptor {
  const holder = target as ControllerWithDescriptor;
  const techne = getOrCreateTechneMetadata(target);
  let descriptor = techne.controller ?? holder[CONTROLLER_DESCRIPTOR];
  if (!descriptor) {
    descriptor = createControllerDescriptor();
  }
  techne.controller = descriptor;
  attachLegacyDescriptor(holder, descriptor);
  return descriptor;
}

export function getOrCreateControllerDescriptorFromMetadata(
  metadata: object,
): ControllerDescriptor {
  const techne = getOrCreateTechneMetadataFromContext(metadata);
  let descriptor = techne.controller;
  if (!descriptor) {
    descriptor = createControllerDescriptor();
    techne.controller = descriptor;
  }
  return descriptor;
}

/** Read the descriptor without creating one. */
export function getControllerDescriptor(target: object): ControllerDescriptor | undefined {
  return (
    getTechneMetadata(target)?.controller ??
    (target as ControllerWithDescriptor)[CONTROLLER_DESCRIPTOR]
  );
}

/** Return the (lazily created) `HandlerDescriptor` for `handlerName` on `target`. */
export function getOrCreateHandlerDescriptor(
  target: object,
  handlerName: string,
): HandlerDescriptor {
  const controller = getOrCreateControllerDescriptor(target);
  return getOrCreateHandlerDescriptorFromController(controller, handlerName);
}

export function getOrCreateHandlerDescriptorFromMetadata(
  metadata: object,
  handlerName: string,
): HandlerDescriptor {
  const controller = getOrCreateControllerDescriptorFromMetadata(metadata);
  return getOrCreateHandlerDescriptorFromController(controller, handlerName);
}

function getOrCreateHandlerDescriptorFromController(
  controller: ControllerDescriptor,
  handlerName: string,
): HandlerDescriptor {
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
