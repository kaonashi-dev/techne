import type { TSchema } from "@sinclair/typebox";

/**
 * Fast schema-driven JSON stringifier.
 *
 * Compiles a TypeBox schema into a hand-rolled function that emits JSON text
 * with pre-encoded property keys, avoiding the per-key string scan and
 * generic property enumeration cost of `JSON.stringify`. Unsupported nodes
 * fall back to `JSON.stringify` for the affected subtree, so correctness is
 * always preserved.
 *
 * Supported nodes: Object, String, Number, Integer, Boolean, Array,
 * Optional, Union (falls back to JSON.stringify), Literal, plus `Any` /
 * `Unknown` (fallback).
 *
 * Compiled stringifiers are cached by schema identity in a WeakMap.
 */

type Stringifier = (value: unknown) => string;

const cache = new WeakMap<TSchema, Stringifier>();

const FALLBACK: Stringifier = (value) => JSON.stringify(value);

export function compileStringifier(schema: TSchema): Stringifier {
  if (!schema || typeof schema !== "object") {
    return FALLBACK;
  }
  const cached = cache.get(schema);
  if (cached) return cached;

  // Build via a recursive expression generator. We accumulate expressions
  // that, concatenated, produce the JSON text for the given value.
  let counter = 0;
  const helpers: Function[] = [];
  const helperNames: string[] = [];

  const addHelper = (fn: Function): string => {
    const name = `__h${helpers.length}`;
    helpers.push(fn);
    helperNames.push(name);
    return name;
  };

  // ASCII fast-path predicate: true iff every code unit is a printable
  // ASCII character that does not require JSON escaping (no `"`, no `\`,
  // no control chars < 0x20, no DEL 0x7F, no chars >= 0x80 including
  // either half of a surrogate pair). When true, the value can be emitted
  // as `'"' + s + '"'` without scanning for escapes.
  const __isAsciiSafe = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c >= 0x7f || c === 0x22 || c === 0x5c) return false;
    }
    return true;
  };
  const asciiSafeName = addHelper(__isAsciiSafe);

  const fallbackAccess = (accessor: string): string => {
    const name = addHelper(FALLBACK);
    return `${name}(${accessor})`;
  };

  /**
   * Returns a JavaScript expression that, when evaluated in the generated
   * function body, produces a JSON string fragment for `accessor`.
   */
  const buildExpr = (node: any, accessor: string): string => {
    if (!node || typeof node !== "object") {
      return fallbackAccess(accessor);
    }

    switch (node.type) {
      case "string":
        // Fast path: ASCII-safe strings (no escapes needed) can skip the
        // per-character scan inside JSON.stringify and just wrap quotes.
        return `(typeof ${accessor}==="string"&&${asciiSafeName}(${accessor})?'"'+${accessor}+'"':JSON.stringify(${accessor}))`;
      case "boolean":
        return `(${accessor}?"true":"false")`;
      case "integer":
      case "number":
        // String() handles non-finite via fallback to "null" semantics —
        // JSON.stringify produces null for NaN/Infinity. Guard for safety.
        return `(Number.isFinite(${accessor})?String(${accessor}):"null")`;
      case "array": {
        const items = node.items;
        if (!items || typeof items !== "object") {
          return fallbackAccess(accessor);
        }
        const v = `v${counter++}`;
        const i = `i${counter++}`;
        const out = `o${counter++}`;
        const elemExpr = buildExpr(items, v);
        // Build an inline IIFE to keep it expression-position.
        return `(function(arr){var ${out}="[";for(var ${i}=0;${i}<arr.length;${i}++){if(${i}>0)${out}+=",";var ${v}=arr[${i}];${out}+=${elemExpr};}return ${out}+"]";})(${accessor})`;
      }
      case "object": {
        const props = node.properties || {};
        const required: string[] = Array.isArray(node.required) ? node.required : [];
        const requiredSet = new Set(required);
        const keys = Object.keys(props);
        if (keys.length === 0) {
          return `"{}"`;
        }

        const out = `o${counter++}`;
        const obj = `b${counter++}`;
        let body = `(function(${obj}){if(${obj}===null||${obj}===undefined)return "null";var ${out}="{";var __first=true;`;

        for (const key of keys) {
          const child = props[key];
          const isOptional = !requiredSet.has(key) || isOptionalNode(child);
          const childAccessor = `${obj}[${JSON.stringify(key)}]`;
          const childExpr = buildExpr(child, childAccessor);
          const encodedKey = JSON.stringify(JSON.stringify(key) + ":");

          if (isOptional) {
            body += `if(${childAccessor}!==undefined){if(!__first)${out}+=",";__first=false;${out}+=${encodedKey};${out}+=${childExpr};}`;
          } else {
            body += `if(!__first)${out}+=",";__first=false;${out}+=${encodedKey};${out}+=${childExpr};`;
          }
        }
        body += `return ${out}+"}";})(${accessor})`;
        return body;
      }
      default:
        break;
    }

    // Literal (Const) → JSON.stringify produces the same value every time,
    // but we can't pre-encode because users may pass mismatching data.
    // Falling back is simplest and stays correct.
    return fallbackAccess(accessor);
  };

  let rootExpr: string;
  try {
    rootExpr = buildExpr(schema, "value");
  } catch {
    // Defensive: any compile error → fallback.
    cache.set(schema, FALLBACK);
    return FALLBACK;
  }

  const src = `return ${rootExpr};`;
  let fn: Stringifier;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(...helperNames, "value", src) as (...args: any[]) => string;
    fn = (value: unknown) => factory(...helpers, value);
  } catch {
    fn = FALLBACK;
  }

  cache.set(schema, fn);
  return fn;
}

// TypeBox uses a Symbol-keyed property (`[Modifier]: "Optional"`) to mark
// optional fields on the inner schema. Detect it without importing the
// internal symbol: scan symbol-keyed properties.
function isOptionalNode(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  for (const sym of Object.getOwnPropertySymbols(node)) {
    const v = (node as any)[sym];
    if (v === "Optional") return true;
  }
  return false;
}
