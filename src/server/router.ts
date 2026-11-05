interface Node<T> {
  statics: Map<string, Node<T>> | undefined;
  param: { name: string; node: Node<T> } | undefined;
  wildcard: T | undefined;
  value: T | undefined;
}

const node = <T>(): Node<T> => ({
  statics: undefined,
  param: undefined,
  wildcard: undefined,
  value: undefined,
});

const EMPTY_PARAMS: Record<string, string> = Object.freeze({}) as Record<string, string>;

function decode(segment: string): string {
  if (segment.indexOf("%") === -1) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Method-keyed router: exact `Map` lookups for static paths, a segment trie
 * for `:param`, optional `:param?` and trailing `*` wildcards.
 */
export class Router<T> {
  private readonly statics = new Map<string, Map<string, T>>();
  private readonly tries = new Map<string, Node<T>>();

  constructor(private readonly strict: boolean) {}

  normalize(path: string): string {
    if (!path.startsWith("/")) path = `/${path}`;
    if (!this.strict && path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return path;
  }

  add(method: string, path: string, value: T): void {
    path = this.normalize(path);
    const optional = /\/:[^/]+\?$/.exec(path);
    if (optional) {
      // `/a/:b?` registers both `/a` and `/a/:b`.
      this.add(method, path.slice(0, optional.index) || "/", value);
      path = path.slice(0, -1);
    }
    if (path.indexOf(":") === -1 && path.indexOf("*") === -1) {
      let table = this.statics.get(method);
      if (!table) this.statics.set(method, (table = new Map()));
      if (!table.has(path)) table.set(path, value);
      return;
    }
    let current = this.tries.get(method);
    if (!current) this.tries.set(method, (current = node()));
    const segments = path.split("/").slice(1);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (segment === "*") {
        if (i !== segments.length - 1) throw new Error(`Wildcard must be last: ${path}`);
        current.wildcard ??= value;
        return;
      }
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        if (current.param && current.param.name !== name) {
          throw new Error(
            `Conflicting parameter names at ${path}: ":${current.param.name}" and ":${name}"`,
          );
        }
        current.param ??= { name, node: node() };
        current = current.param.node;
      } else {
        current.statics ??= new Map();
        let next = current.statics.get(segment);
        if (!next) current.statics.set(segment, (next = node()));
        current = next;
      }
    }
    current.value ??= value;
  }

  /**
   * Finds the route for `method` and `path`. Parameters of the match are left
   * in {@link Router.params} (no per-lookup allocation for static routes).
   */
  find(method: string, path: string): T | undefined {
    if (!this.strict && path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
      path = path.slice(0, -1);
    }
    return (
      this.lookup(method, path) ??
      (method === "HEAD" ? this.lookup("GET", path) : undefined) ??
      this.lookup("ALL", path)
    );
  }

  /** Parameters of the last successful {@link find}. */
  params: Record<string, string> = EMPTY_PARAMS;

  private lookup(method: string, path: string): T | undefined {
    const hit = this.statics.get(method)?.get(path);
    if (hit !== undefined) {
      this.params = EMPTY_PARAMS;
      return hit;
    }
    const root = this.tries.get(method);
    if (!root) return undefined;
    const params: Record<string, string> = {};
    const value = walk(root, path, 1, params);
    if (value !== undefined) this.params = params;
    return value;
  }
}

function walk<T>(
  current: Node<T>,
  path: string,
  start: number,
  params: Record<string, string>,
): T | undefined {
  if (start > path.length) return current.value ?? current.wildcard;
  let end = path.indexOf("/", start);
  if (end === -1) end = path.length;
  const segment = path.slice(start, end);
  const next = current.statics?.get(segment);
  if (next) {
    const found = walk(next, path, end + 1, params);
    if (found !== undefined) return found;
  }
  if (current.param && segment !== "") {
    const found = walk(current.param.node, path, end + 1, params);
    if (found !== undefined) {
      params[current.param.name] = decode(segment);
      return found;
    }
  }
  if (current.wildcard !== undefined) {
    params["*"] = decode(path.slice(start));
    return current.wildcard;
  }
  return undefined;
}

/** Parses a query string. Repeated keys become arrays; `+` decodes to a space. */
export function parseQuery(search: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!search) return out;
  let start = 0;
  const end = search.indexOf("#") === -1 ? search.length : search.indexOf("#");
  while (start < end) {
    let amp = search.indexOf("&", start);
    if (amp === -1 || amp > end) amp = end;
    const pair = search.slice(start, amp);
    start = amp + 1;
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeQuery(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? "" : decodeQuery(pair.slice(eq + 1));
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else if (Array.isArray(prev)) prev.push(value);
    else out[key] = [prev, value];
  }
  return out;
}

function decodeQuery(s: string): string {
  if (s.indexOf("+") !== -1) s = s.replace(/\+/g, " ");
  if (s.indexOf("%") === -1) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
