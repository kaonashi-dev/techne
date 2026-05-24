import * as fs from "fs/promises";
import * as path from "path";
import type { TechneConfig } from "../core/define-techne-config";
import { Container, isCustomProvider } from "../core/container";
import { Scanner } from "../core/scanner";
import { RouterExplorer, type DiscoveredRouteDefinition } from "../core/router/router-explorer";
import type { ParamMetadata } from "../decorators/params.decorator";
import type { RouteMetadata } from "../decorators/routes.decorator";
import { getControllerDescriptor } from "../core/metadata-store";
import type { Logger } from "../services/logger.service";

const ROUTE_TABLE_VERSION = 1;
const ROUTE_TABLE_PATH = path.join(".techne", "routes.json");
const TECHNE_CONFIG_CANDIDATES = [
  "techne.config.ts",
  "techne.config.js",
  "techne.config.mjs",
] as const;

interface SerializedParamMetadata {
  index: number;
  type: ParamMetadata["type"];
  name?: string;
  data?: unknown;
}

interface SerializedRoute {
  controller: string;
  path: string;
  method: RouteMetadata["method"];
  handlerName: string;
  fullPath: string;
  schema?: unknown;
  middlewares: string[];
  guards: string[];
  filters: string[];
  responseHooks: string[];
  paramsMetadata: SerializedParamMetadata[];
  versions: string[];
}

interface PrecompiledRouteTable {
  version: number;
  generatedAt: string;
  sourceHash: string;
  routes: SerializedRoute[];
}

export interface PrecompileResult {
  path: string;
  routes: number;
  sourceHash: string;
}

export async function precompileRoutes(cwd = process.cwd()): Promise<PrecompileResult> {
  const configPath = await findConfigPath(cwd);
  if (!configPath) {
    throw new Error(`techne.config.ts not found in ${cwd}.`);
  }

  const mod = await import(configPath);
  const config = mod?.default as TechneConfig | undefined;
  if (!config) {
    throw new Error(`${path.basename(configPath)} must export a default flat app config.`);
  }

  const container = new Container();
  const scanner = new Scanner({ logger: false, container });
  scanner.scanFlat(flattenBootstrapConfig(config));

  const routes = new RouterExplorer(scanner).explore();
  const table: PrecompiledRouteTable = {
    version: ROUTE_TABLE_VERSION,
    generatedAt: new Date().toISOString(),
    sourceHash: computeRouteSourceHash(scanner.getControllers()),
    routes: routes.map(serializeRoute),
  };

  const outPath = path.join(cwd, ROUTE_TABLE_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await Bun.write(outPath, `${JSON.stringify(table, null, 2)}\n`);

  return { path: outPath, routes: table.routes.length, sourceHash: table.sourceHash };
}

export async function loadPrecompiledRoutesForScanner(
  scanner: Scanner,
  cwd = process.cwd(),
  logger?: Pick<Logger, "log" | "warn" | "debug">,
): Promise<DiscoveredRouteDefinition[] | undefined> {
  const tablePath = path.join(cwd, ROUTE_TABLE_PATH);
  const file = Bun.file(tablePath);
  if (!(await file.exists())) return undefined;

  let table: PrecompiledRouteTable;
  try {
    table = JSON.parse(await file.text()) as PrecompiledRouteTable;
  } catch (error) {
    logger?.warn?.(
      `Ignoring precompiled route table: ${error instanceof Error ? error.message : String(error)}`,
      "Router",
    );
    return undefined;
  }

  if (table.version !== ROUTE_TABLE_VERSION || !Array.isArray(table.routes)) {
    logger?.warn?.("Ignoring precompiled route table: unsupported format.", "Router");
    return undefined;
  }

  const liveHash = computeRouteSourceHash(scanner.getControllers());
  if (table.sourceHash !== liveHash) {
    logger?.warn?.("Ignoring precompiled route table: source hash mismatch.", "Router");
    return undefined;
  }

  try {
    const routes = hydrateRoutes(table.routes, scanner);
    logger?.log?.(`Using precompiled route table (${routes.length} route(s))`, "Router");
    return routes;
  } catch (error) {
    logger?.warn?.(
      `Ignoring precompiled route table: ${error instanceof Error ? error.message : String(error)}`,
      "Router",
    );
    return undefined;
  }
}

async function findConfigPath(cwd: string): Promise<string | undefined> {
  for (const name of TECHNE_CONFIG_CANDIDATES) {
    const candidate = path.join(cwd, name);
    if (await Bun.file(candidate).exists()) return candidate;
  }
  return undefined;
}

function flattenBootstrapConfig(config: TechneConfig): { controllers?: any[]; providers?: any[] } {
  const controllers: any[] = config.controllers ? config.controllers.slice() : [];
  const providers: any[] = config.providers ? config.providers.slice() : [];

  for (const feature of config.features ?? []) {
    if (feature.controllers) controllers.push(...feature.controllers);
    if (feature.providers) providers.push(...feature.providers);
  }

  return { controllers, providers };
}

function serializeRoute(route: DiscoveredRouteDefinition): SerializedRoute {
  assertJsonSerializable(route.schema, `${route.controller.name}.${route.handlerName} schema`);
  return {
    controller: tokenName(route.controller, "controller"),
    path: route.path,
    method: route.method,
    handlerName: route.handlerName,
    fullPath: route.fullPath,
    schema: route.schema,
    middlewares: serializeTokens(route.middlewares, "middleware"),
    guards: serializeTokens(route.guards, "guard"),
    filters: serializeTokens(route.filters, "filter"),
    responseHooks: serializeTokens(route.responseHooks, "response hook"),
    paramsMetadata: route.paramsMetadata.map(serializeParam),
    versions: route.versions,
  };
}

function serializeParam(param: ParamMetadata): SerializedParamMetadata {
  if (param.type === "custom") {
    throw new Error("AOT route table does not support custom parameter decorators yet.");
  }
  return {
    index: param.index,
    type: param.type,
    name: param.name,
    data: param.data,
  };
}

function serializeTokens(tokens: any[], label: string): string[] {
  return tokens.map((token) => tokenName(token, label));
}

function tokenName(token: any, label: string): string {
  const name =
    typeof token === "function"
      ? token.name
      : token && typeof token === "object" && token.constructor
        ? token.constructor.name
        : undefined;
  if (!name) throw new Error(`AOT route table cannot serialize anonymous ${label}.`);
  return name;
}

function hydrateRoutes(routes: SerializedRoute[], scanner: Scanner): DiscoveredRouteDefinition[] {
  const controllerByName = new Map<string, any>();
  for (const controller of scanner.getControllers()) {
    if (controller?.name) controllerByName.set(controller.name, controller);
  }

  const tokenByName = buildTokenMap(scanner);
  return routes.map((route) => {
    const controller = controllerByName.get(route.controller);
    if (!controller) throw new Error(`controller ${route.controller} is not registered.`);
    return {
      path: route.path,
      method: route.method,
      handlerName: route.handlerName,
      schema: route.schema as RouteMetadata["schema"],
      controller,
      fullPath: route.fullPath,
      middlewares: hydrateTokens(route.middlewares, tokenByName, "middleware"),
      guards: hydrateTokens(route.guards, tokenByName, "guard"),
      filters: hydrateTokens(route.filters, tokenByName, "filter"),
      responseHooks: hydrateTokens(route.responseHooks, tokenByName, "response hook"),
      paramsMetadata: route.paramsMetadata.map((param) => ({ ...param })),
      versions: route.versions,
    };
  });
}

function buildTokenMap(scanner: Scanner): Map<string, any> {
  const tokens = new Map<string, any>();
  const add = (token: any) => {
    const name =
      typeof token === "function"
        ? token.name
        : token && typeof token === "object" && token.constructor
          ? token.constructor.name
          : undefined;
    if (name && !tokens.has(name)) tokens.set(name, token);
  };

  for (const controller of scanner.getControllers()) {
    add(controller);
    const descriptor = getControllerDescriptor(controller);
    if (!descriptor) continue;
    for (const token of descriptor.middlewares) add(token);
    for (const token of descriptor.guards) add(token);
    for (const token of descriptor.filters) add(token);
    for (const token of descriptor.responseHooks) add(token);
    for (const handler of Object.values(descriptor.handlers)) {
      for (const token of handler.middlewares) add(token);
      for (const token of handler.guards) add(token);
      for (const token of handler.filters) add(token);
      for (const token of handler.responseHooks) add(token);
    }
  }

  for (const provider of scanner.getProviders()) {
    if (isCustomProvider(provider)) {
      add((provider as any).provide);
      if ("useClass" in provider) add((provider as any).useClass);
      if ("useExisting" in provider) add((provider as any).useExisting);
      if ("useValue" in provider) add((provider as any).useValue);
    } else {
      add(provider);
    }
  }

  return tokens;
}

function hydrateTokens(tokens: string[], map: Map<string, any>, label: string): any[] {
  return tokens.map((name) => {
    const token = map.get(name);
    if (!token) throw new Error(`${label} ${name} is not registered.`);
    return token;
  });
}

export function computeRouteSourceHash(controllers: readonly any[]): string {
  const parts: string[] = [];
  for (const controller of controllers) {
    parts.push(controller?.name ?? "<anonymous>");
    parts.push(Function.prototype.toString.call(controller));
    const descriptor = getControllerDescriptor(controller);
    if (descriptor) {
      parts.push(
        JSON.stringify({
          prefix: descriptor.prefix,
          versions: descriptor.versions,
          routes: descriptor.routes,
          middlewares: descriptor.middlewares.map((token) => tokenName(token, "middleware")),
          guards: descriptor.guards.map((token) => tokenName(token, "guard")),
          filters: descriptor.filters.map((token) => tokenName(token, "filter")),
          responseHooks: descriptor.responseHooks.map((token) => tokenName(token, "response hook")),
          paramsByHandler: simplifyParams(descriptor.paramsByHandler),
          handlers: Object.fromEntries(
            Object.entries(descriptor.handlers).map(([name, handler]) => [
              name,
              {
                middlewares: handler.middlewares.map((token) => tokenName(token, "middleware")),
                guards: handler.guards.map((token) => tokenName(token, "guard")),
                filters: handler.filters.map((token) => tokenName(token, "filter")),
                responseHooks: handler.responseHooks.map((token) =>
                  tokenName(token, "response hook"),
                ),
                versions: handler.versions,
              },
            ]),
          ),
        }),
      );
    }
    const proto = controller?.prototype;
    if (!proto) continue;
    for (const name of Object.getOwnPropertyNames(proto).sort()) {
      if (name === "constructor") continue;
      const value = proto[name];
      if (typeof value === "function") {
        parts.push(name, Function.prototype.toString.call(value));
      }
    }
  }
  return stableHash(parts.join("\n"));
}

function simplifyParams(
  paramsByHandler: Record<string, ParamMetadata[]>,
): Record<string, unknown[]> {
  return Object.fromEntries(
    Object.entries(paramsByHandler).map(([handler, params]) => [
      handler,
      params.map((param) => ({
        index: param.index,
        type: param.type,
        name: param.name,
        data: param.data,
        dtoClass: param.dtoClass?.name,
        metatype: param.metatype?.name,
        hasFactory: typeof param.factory === "function",
      })),
    ]),
  );
}

function stableHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

function assertJsonSerializable(value: unknown, label: string): void {
  if (value === undefined) return;
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `AOT route table cannot serialize ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
