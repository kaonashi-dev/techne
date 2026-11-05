import type { Static, TSchema, ValidationIssue, Validator } from "./types";

/**
 * Techne's schema compiler.
 *
 * `Check` is generated as a straight-line boolean expression and cached by
 * schema identity. `Errors` is a small interpreter that only runs after a
 * failed check, and doubles as the fallback when dynamic code generation is
 * unavailable. The supported keyword set is the subset Techne's builders and
 * the legacy decorators produce.
 */

const validators = new WeakMap<object, Validator<any>>();

export function Compile<S extends TSchema>(schema: S): Validator<S> {
  const key = schema as object;
  const cached = validators.get(key);
  if (cached) return cached;
  const validator: Validator<S> = {
    Check: compileCheck(schema) as Validator<S>["Check"],
    Errors: (value) => {
      const issues: ValidationIssue[] = [];
      collectErrors(schema, value, "", "#", issues);
      return issues;
    },
    Convert: (value) => convert(schema, value),
  };
  validators.set(key, validator);
  return validator;
}

export const compile = Compile;

// ─── Check compilation ───────────────────────────────────────────────────────

type Helper = (...args: any[]) => unknown;
type CheckFn = (value: unknown) => boolean;

function compileCheck(schema: TSchema): CheckFn {
  try {
    const helpers: Helper[] = [];
    const addHelper = (fn: Helper): string => {
      const name = `h${helpers.length}`;
      helpers.push(fn);
      return name;
    };
    let counter = 0;
    const next = (prefix: string): string => `${prefix}${counter++}`;
    const expression = buildExpression(schema, "value", addHelper, next);
    // Bind the helpers once: the returned function takes only `value`, so a
    // check never spreads the helper list.
    const factory = new Function(
      ...helpers.map((_, index) => `h${index}`),
      `return function check(value){return ${expression};};`,
    ) as (...args: Helper[]) => CheckFn;
    return factory(...helpers);
  } catch {
    return (value) => checkSchema(schema, value);
  }
}

function buildExpression(
  schema: unknown,
  value: string,
  addHelper: (fn: Helper) => string,
  next: (prefix: string) => string,
): string {
  if (schema === false) return "false";
  if (schema === true || schema === null || typeof schema !== "object") return "true";
  const node = schema as Record<string, any>;
  const parts: string[] = [];

  if (node.type !== undefined) {
    parts.push(typeExpression(node.type, value));
  }

  if (node.const !== undefined) {
    parts.push(constExpression(value, node.const, addHelper));
  }

  if (Array.isArray(node.enum)) {
    const values = node.enum as unknown[];
    if (values.every(isPrimitive)) {
      parts.push(
        `(${values.map((entry) => `${value}===${JSON.stringify(entry)}`).join("||") || "false"})`,
      );
    } else {
      const equals = addHelper(deepEqual);
      parts.push(`${equals}(${value},${JSON.stringify(values)})`);
    }
  }

  if (Array.isArray(node.allOf)) {
    const members = node.allOf as unknown[];
    parts.push(
      `(${members.map((member) => buildExpression(member, value, addHelper, next)).join("&&") || "true"})`,
    );
  }

  if (Array.isArray(node.anyOf)) {
    const members = node.anyOf as unknown[];
    parts.push(
      `(${members.map((member) => buildExpression(member, value, addHelper, next)).join("||") || "false"})`,
    );
  }

  if (Array.isArray(node.oneOf)) {
    const members = node.oneOf as unknown[];
    const counts = members.map(
      (member) => `(${buildExpression(member, value, addHelper, next)}?1:0)`,
    );
    parts.push(`(${counts.join("+") || "0"})===1`);
  }

  if (node.not !== undefined) {
    parts.push(`!(${buildExpression(node.not, value, addHelper, next)})`);
  }

  if (
    node.type === "string" ||
    node.minLength !== undefined ||
    node.maxLength !== undefined ||
    node.pattern !== undefined ||
    node.format !== undefined
  ) {
    const guard = node.type === "string" ? "" : `typeof ${value}==="string"&&`;
    if (node.minLength !== undefined) {
      parts.push(`(${guard}${value}.length>=${Number(node.minLength)})`);
    }
    if (node.maxLength !== undefined) {
      parts.push(`(${guard}${value}.length<=${Number(node.maxLength)})`);
    }
    if (node.pattern !== undefined) {
      const test = addHelper(regexTest(String(node.pattern)));
      parts.push(`(${guard}${test}(${value}))`);
    }
    if (node.format !== undefined) {
      const check = addHelper(checkFormat);
      parts.push(`(${guard}${check}(${JSON.stringify(String(node.format))},${value}))`);
    }
  }

  if (
    node.type === "number" ||
    node.type === "integer" ||
    node.minimum !== undefined ||
    node.maximum !== undefined ||
    node.exclusiveMinimum !== undefined ||
    node.exclusiveMaximum !== undefined ||
    node.multipleOf !== undefined
  ) {
    const guard =
      node.type === "number" || node.type === "integer" ? "" : `typeof ${value}==="number"&&`;
    if (node.minimum !== undefined) {
      parts.push(`(${guard}${value}>=${Number(node.minimum)})`);
    }
    if (node.maximum !== undefined) {
      parts.push(`(${guard}${value}<=${Number(node.maximum)})`);
    }
    if (node.exclusiveMinimum !== undefined) {
      parts.push(`(${guard}${value}>${Number(node.exclusiveMinimum)})`);
    }
    if (node.exclusiveMaximum !== undefined) {
      parts.push(`(${guard}${value}<${Number(node.exclusiveMaximum)})`);
    }
    if (node.multipleOf !== undefined) {
      const multiple = addHelper(isMultipleOf);
      parts.push(`(${guard}${multiple}(${value},${Number(node.multipleOf)}))`);
    }
  }

  if (
    node.type === "object" ||
    node.properties !== undefined ||
    node.required !== undefined ||
    node.additionalProperties !== undefined ||
    node.patternProperties !== undefined ||
    node.minProperties !== undefined ||
    node.maxProperties !== undefined
  ) {
    parts.push(objectExpression(node, value, addHelper, next));
  }

  if (
    node.type === "array" ||
    node.items !== undefined ||
    node.prefixItems !== undefined ||
    node.minItems !== undefined ||
    node.maxItems !== undefined ||
    node.uniqueItems !== undefined
  ) {
    parts.push(arrayExpression(node, value, addHelper, next));
  }

  return parts.length > 0 ? parts.join("&&") : "true";
}

function typeExpression(type: unknown, value: string): string {
  if (Array.isArray(type)) {
    return `(${type.map((entry) => typeExpression(entry, value)).join("||") || "false"})`;
  }
  switch (type) {
    case "string":
      return `(typeof ${value}==="string")`;
    case "number":
      return `(typeof ${value}==="number"&&Number.isFinite(${value}))`;
    case "integer":
      return `(typeof ${value}==="number"&&Number.isInteger(${value}))`;
    case "boolean":
      return `(typeof ${value}==="boolean")`;
    case "null":
      return `(${value}===null)`;
    case "array":
      return `Array.isArray(${value})`;
    case "object":
      return `(${value}!==null&&typeof ${value}==="object"&&!Array.isArray(${value}))`;
    default:
      return "true";
  }
}

function constExpression(
  value: string,
  expected: unknown,
  addHelper: (fn: Helper) => string,
): string {
  if (isPrimitive(expected)) {
    return `(${value}===${JSON.stringify(expected)})`;
  }
  const equals = addHelper(deepEqual);
  return `${equals}(${value},${JSON.stringify(expected)})`;
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function access(value: string, key: string): string {
  return `${value}[${JSON.stringify(key)}]`;
}

function objectExpression(
  node: Record<string, any>,
  value: string,
  addHelper: (fn: Helper) => string,
  next: (prefix: string) => string,
): string {
  const parts: string[] =
    node.type === "object"
      ? []
      : [`(${value}!==null&&typeof ${value}==="object"&&!Array.isArray(${value}))`];
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const required = Array.isArray(node.required) ? (node.required as string[]) : [];
  for (const key of required) {
    parts.push(`(${access(value, key)}!==undefined)`);
  }
  for (const key of Object.keys(properties)) {
    const child = buildExpression(properties[key], access(value, key), addHelper, next);
    parts.push(`(${access(value, key)}===undefined||(${child}))`);
  }
  if (node.minProperties !== undefined) {
    parts.push(`(Object.keys(${value}).length>=${Number(node.minProperties)})`);
  }
  if (node.maxProperties !== undefined) {
    parts.push(`(Object.keys(${value}).length<=${Number(node.maxProperties)})`);
  }

  const patterns = (node.patternProperties ?? undefined) as Record<string, unknown> | undefined;
  const additional = node.additionalProperties;
  const hasPatterns = patterns !== undefined && Object.keys(patterns).length > 0;
  if (hasPatterns || (additional !== undefined && additional !== true)) {
    const object = next("o");
    const key = next("k");
    const matched = next("m");
    let body = `(function(${object}){`;
    if (hasPatterns) body += `var ${matched}=false;`;
    body += `for(var ${key} in ${object}){if(!Object.prototype.hasOwnProperty.call(${object},${key}))continue;`;
    if (hasPatterns) body += `${matched}=false;`;
    for (const [pattern, child] of Object.entries(patterns ?? {})) {
      const test = addHelper(regexTest(pattern));
      const childExpression = buildExpression(child, `${object}[${key}]`, addHelper, next);
      body += `if(${test}(${key})){${matched}=true;if(!(${childExpression}))return false;}`;
    }
    if (additional !== undefined && additional !== true) {
      const fixed = Object.keys(properties);
      const fixedCheck =
        fixed.length === 0
          ? "false"
          : fixed.map((name) => `${key}===${JSON.stringify(name)}`).join("||");
      const condition = hasPatterns ? `!(${fixedCheck})&&!${matched}` : `!(${fixedCheck})`;
      if (additional === false) {
        body += `if(${condition})return false;`;
      } else {
        const childExpression = buildExpression(additional, `${object}[${key}]`, addHelper, next);
        body += `if(${condition}){if(!(${childExpression}))return false;}`;
      }
    }
    body += `}return true;})(${value})`;
    parts.push(body);
  }
  return parts.length === 0 ? "true" : parts.length === 1 ? parts[0]! : `(${parts.join("&&")})`;
}

function arrayExpression(
  node: Record<string, any>,
  value: string,
  addHelper: (fn: Helper) => string,
  next: (prefix: string) => string,
): string {
  const parts: string[] = node.type === "array" ? [] : [`Array.isArray(${value})`];
  if (node.minItems !== undefined) {
    parts.push(`(${value}.length>=${Number(node.minItems)})`);
  }
  if (node.maxItems !== undefined) {
    parts.push(`(${value}.length<=${Number(node.maxItems)})`);
  }
  if (node.uniqueItems === true) {
    const unique = addHelper(uniqueItems);
    parts.push(`${unique}(${value})`);
  }

  const tuple = Array.isArray(node.prefixItems)
    ? (node.prefixItems as unknown[])
    : Array.isArray(node.items)
      ? (node.items as unknown[])
      : undefined;
  if (tuple !== undefined) {
    for (let index = 0; index < tuple.length; index++) {
      const child = buildExpression(tuple[index], `${value}[${index}]`, addHelper, next);
      parts.push(`(${value}.length<=${index}||(${child}))`);
    }
    if (Array.isArray(node.prefixItems)) {
      const items = node.items;
      if (items === false) {
        parts.push(`(${value}.length<=${tuple.length})`);
      } else if (items !== undefined && items !== true) {
        const item = next("i");
        const array = next("a");
        const child = buildExpression(items, `${array}[${item}]`, addHelper, next);
        parts.push(
          `(function(${array}){for(var ${item}=${tuple.length};${item}<${array}.length;${item}++){if(!(${child}))return false;}return true;})(${value})`,
        );
      }
    } else if (node.additionalItems === false) {
      parts.push(`(${value}.length<=${tuple.length})`);
    } else if (node.additionalItems !== undefined && node.additionalItems !== true) {
      const item = next("i");
      const array = next("a");
      const child = buildExpression(node.additionalItems, `${array}[${item}]`, addHelper, next);
      parts.push(
        `(function(${array}){for(var ${item}=${tuple.length};${item}<${array}.length;${item}++){if(!(${child}))return false;}return true;})(${value})`,
      );
    }
  } else if (node.items !== undefined && node.items !== true) {
    if (node.items === false) {
      parts.push(`(${value}.length===0)`);
    } else {
      const item = next("i");
      const array = next("a");
      const child = buildExpression(node.items, `${array}[${item}]`, addHelper, next);
      parts.push(
        `(function(${array}){for(var ${item}=0;${item}<${array}.length;${item}++){if(!(${child}))return false;}return true;})(${value})`,
      );
    }
  }
  return parts.length === 0 ? "true" : `(${parts.join("&&")})`;
}

function regexTest(pattern: string): Helper {
  let regex: RegExp | undefined;
  try {
    regex = new RegExp(pattern);
  } catch {
    regex = undefined;
  }
  return (value: unknown) => regex === undefined || regex.test(String(value));
}

function isMultipleOf(value: unknown, multiple: number): boolean {
  if (typeof value !== "number" || multiple === 0) return false;
  const quotient = value / multiple;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

// ─── Formats ─────────────────────────────────────────────────────────────────

const EMAIL =
  /^(?!.*\.\.)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const URI = /^[a-z][a-z0-9+.-]*:[^\s]*$/i;

function checkFormat(name: string, value: unknown): boolean {
  if (typeof value !== "string") return true;
  switch (name) {
    case "email":
      return EMAIL.test(value);
    case "uuid":
      return UUID.test(value);
    case "date-time":
      return DATE_TIME.test(value);
    case "date":
      return DATE.test(value);
    case "uri":
      return URI.test(value);
    default:
      return true;
  }
}

// ─── Interpreter (errors + no-eval fallback) ────────────────────────────────

function checkSchema(schema: unknown, value: unknown): boolean {
  if (schema === false) return false;
  if (schema === true || schema === null || typeof schema !== "object") return true;
  const node = schema as Record<string, any>;

  if (node.type !== undefined && !matchesType(node.type, value)) return false;
  if (node.const !== undefined && !deepEqual(value, node.const)) return false;
  if (Array.isArray(node.enum) && !node.enum.some((entry: unknown) => deepEqual(value, entry)))
    return false;

  if (Array.isArray(node.allOf)) {
    for (const member of node.allOf) if (!checkSchema(member, value)) return false;
  }
  if (Array.isArray(node.anyOf)) {
    if (!node.anyOf.some((member: unknown) => checkSchema(member, value))) return false;
  }
  if (Array.isArray(node.oneOf)) {
    let matches = 0;
    for (const member of node.oneOf) if (checkSchema(member, value)) matches++;
    if (matches !== 1) return false;
  }
  if (node.not !== undefined && checkSchema(node.not, value)) return false;

  if (typeof value === "string") {
    if (node.minLength !== undefined && value.length < Number(node.minLength)) return false;
    if (node.maxLength !== undefined && value.length > Number(node.maxLength)) return false;
    if (node.pattern !== undefined) {
      try {
        if (!new RegExp(String(node.pattern)).test(value)) return false;
      } catch {
        // Invalid patterns are ignored, as in the generated checker.
      }
    }
    if (node.format !== undefined && !checkFormat(String(node.format), value)) return false;
  }

  if (typeof value === "number") {
    if (node.minimum !== undefined && !(value >= Number(node.minimum))) return false;
    if (node.maximum !== undefined && !(value <= Number(node.maximum))) return false;
    if (node.exclusiveMinimum !== undefined && !(value > Number(node.exclusiveMinimum)))
      return false;
    if (node.exclusiveMaximum !== undefined && !(value < Number(node.exclusiveMaximum)))
      return false;
    if (node.multipleOf !== undefined && !isMultipleOf(value, Number(node.multipleOf)))
      return false;
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    if (Array.isArray(node.required)) {
      for (const key of node.required as string[]) {
        if (object[key] === undefined) return false;
      }
    }
    if (node.minProperties !== undefined && Object.keys(object).length < Number(node.minProperties))
      return false;
    if (node.maxProperties !== undefined && Object.keys(object).length > Number(node.maxProperties))
      return false;
    for (const key of Object.keys(properties)) {
      if (object[key] !== undefined && !checkSchema(properties[key], object[key])) return false;
    }
    const patterns = (node.patternProperties ?? {}) as Record<string, unknown>;
    const patternEntries = Object.entries(patterns);
    for (const key of Object.keys(object)) {
      let matched = false;
      for (const [pattern, child] of patternEntries) {
        if (safeRegex(pattern).test(key)) {
          matched = true;
          if (!checkSchema(child, object[key])) return false;
        }
      }
      if (!matched && properties[key] === undefined) {
        if (node.additionalProperties === false) return false;
        if (
          node.additionalProperties !== undefined &&
          node.additionalProperties !== true &&
          !checkSchema(node.additionalProperties, object[key])
        ) {
          return false;
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < Number(node.minItems)) return false;
    if (node.maxItems !== undefined && value.length > Number(node.maxItems)) return false;
    if (node.uniqueItems === true && !uniqueItems(value)) return false;
    const prefix = Array.isArray(node.prefixItems)
      ? (node.prefixItems as unknown[])
      : Array.isArray(node.items)
        ? (node.items as unknown[])
        : undefined;
    if (prefix !== undefined) {
      for (let index = 0; index < prefix.length && index < value.length; index++) {
        if (!checkSchema(prefix[index], value[index])) return false;
      }
      if (Array.isArray(node.prefixItems)) {
        if (node.items === false && value.length > prefix.length) return false;
        if (node.items !== undefined && node.items !== true) {
          for (let index = prefix.length; index < value.length; index++) {
            if (!checkSchema(node.items, value[index])) return false;
          }
        }
      } else if (node.additionalItems === false) {
        if (value.length > prefix.length) return false;
      } else if (node.additionalItems !== undefined && node.additionalItems !== true) {
        for (let index = prefix.length; index < value.length; index++) {
          if (!checkSchema(node.additionalItems, value[index])) return false;
        }
      }
    } else if (node.items !== undefined && node.items !== true) {
      if (node.items === false && value.length > 0) return false;
      if (node.items !== false) {
        for (const item of value) if (!checkSchema(node.items, item)) return false;
      }
    }
  }

  return true;
}

function matchesType(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) return type.some((entry) => matchesType(entry, value));
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    default:
      return true;
  }
}

// ─── Error collection ───────────────────────────────────────────────────────

function collectErrors(
  schema: unknown,
  value: unknown,
  instancePath: string,
  schemaPath: string,
  issues: ValidationIssue[],
): void {
  if (schema === true) return;
  if (schema === false) {
    issues.push({
      keyword: "boolean",
      schemaPath,
      instancePath,
      params: {},
      message: "schema is false",
    });
    return;
  }
  if (schema === null || typeof schema !== "object") return;
  const node = schema as Record<string, any>;

  if (node.type !== undefined && !matchesType(node.type, value)) {
    issues.push({
      keyword: "type",
      schemaPath,
      instancePath,
      params: { type: node.type },
      message: `must be ${Array.isArray(node.type) ? node.type.join(" or ") : String(node.type)}`,
    });
  }

  if (node.const !== undefined && !deepEqual(value, node.const)) {
    issues.push({
      keyword: "const",
      schemaPath,
      instancePath,
      params: { allowedValue: node.const },
      message: "must be equal to constant",
    });
  }

  if (Array.isArray(node.enum) && !node.enum.some((entry: unknown) => deepEqual(value, entry))) {
    issues.push({
      keyword: "enum",
      schemaPath,
      instancePath,
      params: { allowedValues: node.enum },
      message: "must be equal to one of the allowed values",
    });
  }

  if (Array.isArray(node.allOf)) {
    for (let index = 0; index < node.allOf.length; index++) {
      collectErrors(node.allOf[index], value, instancePath, `${schemaPath}/allOf/${index}`, issues);
    }
  }

  if (Array.isArray(node.anyOf)) {
    if (!node.anyOf.some((member: unknown) => checkSchema(member, value))) {
      for (let index = 0; index < node.anyOf.length; index++) {
        collectErrors(
          node.anyOf[index],
          value,
          instancePath,
          `${schemaPath}/anyOf/${index}`,
          issues,
        );
      }
      issues.push({
        keyword: "anyOf",
        schemaPath,
        instancePath,
        params: {},
        message: "must match a schema in anyOf",
      });
    }
  }

  if (Array.isArray(node.oneOf)) {
    let matches = 0;
    for (const member of node.oneOf) if (checkSchema(member, value)) matches++;
    if (matches !== 1) {
      for (let index = 0; index < node.oneOf.length; index++) {
        collectErrors(
          node.oneOf[index],
          value,
          instancePath,
          `${schemaPath}/oneOf/${index}`,
          issues,
        );
      }
      issues.push({
        keyword: "oneOf",
        schemaPath,
        instancePath,
        params: {},
        message: "must match exactly one schema in oneOf",
      });
    }
  }

  if (node.not !== undefined && checkSchema(node.not, value)) {
    issues.push({
      keyword: "not",
      schemaPath,
      instancePath,
      params: {},
      message: "must not be valid",
    });
  }

  if (typeof value === "string") {
    collectStringErrors(node, value, instancePath, schemaPath, issues);
  }

  if (typeof value === "number") {
    collectNumberErrors(node, value, instancePath, schemaPath, issues);
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    collectObjectErrors(node, value as Record<string, unknown>, instancePath, schemaPath, issues);
  }

  if (Array.isArray(value)) {
    collectArrayErrors(node, value, instancePath, schemaPath, issues);
  }
}

function collectStringErrors(
  node: Record<string, any>,
  value: string,
  instancePath: string,
  schemaPath: string,
  issues: ValidationIssue[],
): void {
  if (node.minLength !== undefined && value.length < Number(node.minLength)) {
    issues.push({
      keyword: "minLength",
      schemaPath,
      instancePath,
      params: { limit: Number(node.minLength) },
      message: `must not have fewer than ${Number(node.minLength)} characters`,
    });
  }
  if (node.maxLength !== undefined && value.length > Number(node.maxLength)) {
    issues.push({
      keyword: "maxLength",
      schemaPath,
      instancePath,
      params: { limit: Number(node.maxLength) },
      message: `must not have more than ${Number(node.maxLength)} characters`,
    });
  }
  if (node.pattern !== undefined) {
    let matches: boolean;
    try {
      matches = new RegExp(String(node.pattern)).test(value);
    } catch {
      matches = true;
    }
    if (!matches) {
      issues.push({
        keyword: "pattern",
        schemaPath,
        instancePath,
        params: { pattern: node.pattern },
        message: `must match pattern "${String(node.pattern)}"`,
      });
    }
  }
  if (node.format !== undefined && !checkFormat(String(node.format), value)) {
    issues.push({
      keyword: "format",
      schemaPath,
      instancePath,
      params: { format: node.format },
      message: `must match format "${String(node.format)}"`,
    });
  }
}

function collectNumberErrors(
  node: Record<string, any>,
  value: number,
  instancePath: string,
  schemaPath: string,
  issues: ValidationIssue[],
): void {
  const comparisons: Array<[string, boolean, string, number]> = [
    ["minimum", node.minimum !== undefined && value >= Number(node.minimum), ">=", node.minimum],
    ["maximum", node.maximum !== undefined && value <= Number(node.maximum), "<=", node.maximum],
    [
      "exclusiveMinimum",
      node.exclusiveMinimum !== undefined && value > Number(node.exclusiveMinimum),
      ">",
      node.exclusiveMinimum,
    ],
    [
      "exclusiveMaximum",
      node.exclusiveMaximum !== undefined && value < Number(node.exclusiveMaximum),
      "<",
      node.exclusiveMaximum,
    ],
  ];
  for (const [keyword, valid, comparison, limit] of comparisons) {
    if (limit === undefined || valid) continue;
    issues.push({
      keyword,
      schemaPath,
      instancePath,
      params: { comparison, limit: Number(limit) },
      message: `must be ${comparison} ${Number(limit)}`,
    });
  }
  if (node.multipleOf !== undefined && !isMultipleOf(value, Number(node.multipleOf))) {
    issues.push({
      keyword: "multipleOf",
      schemaPath,
      instancePath,
      params: { multipleOf: node.multipleOf },
      message: `must be multiple of ${Number(node.multipleOf)}`,
    });
  }
}

function collectObjectErrors(
  node: Record<string, any>,
  value: Record<string, unknown>,
  instancePath: string,
  schemaPath: string,
  issues: ValidationIssue[],
): void {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  if (Array.isArray(node.required)) {
    const missing = (node.required as string[]).filter((key) => value[key] === undefined);
    if (missing.length > 0) {
      issues.push({
        keyword: "required",
        schemaPath,
        instancePath,
        params: { requiredProperties: missing },
        message: `must have required properties ${missing.join(", ")}`,
      });
    }
  }

  if (node.minProperties !== undefined && Object.keys(value).length < Number(node.minProperties)) {
    issues.push({
      keyword: "minProperties",
      schemaPath,
      instancePath,
      params: { limit: Number(node.minProperties) },
      message: `must not have fewer than ${Number(node.minProperties)} properties`,
    });
  }
  if (node.maxProperties !== undefined && Object.keys(value).length > Number(node.maxProperties)) {
    issues.push({
      keyword: "maxProperties",
      schemaPath,
      instancePath,
      params: { limit: Number(node.maxProperties) },
      message: `must not have more than ${Number(node.maxProperties)} properties`,
    });
  }

  for (const key of Object.keys(properties)) {
    if (value[key] === undefined) continue;
    collectErrors(
      properties[key],
      value[key],
      `${instancePath}/${escapePointer(key)}`,
      `${schemaPath}/properties/${escapePointer(key)}`,
      issues,
    );
  }

  const patterns = (node.patternProperties ?? {}) as Record<string, unknown>;
  const patternEntries = Object.entries(patterns).map(
    ([pattern, child]) => [pattern, child, safeRegex(pattern)] as const,
  );
  const extras: string[] = [];
  for (const key of Object.keys(value)) {
    let matched = false;
    for (const [pattern, child, regex] of patternEntries) {
      if (!regex.test(key)) continue;
      matched = true;
      collectErrors(
        child,
        value[key],
        `${instancePath}/${escapePointer(key)}`,
        `${schemaPath}/patternProperties/${escapePointer(pattern)}`,
        issues,
      );
    }
    if (!matched && properties[key] === undefined) extras.push(key);
  }

  if (extras.length > 0 && node.additionalProperties === false) {
    issues.push({
      keyword: "additionalProperties",
      schemaPath,
      instancePath,
      params: { additionalProperties: extras },
      message: "must not have additional properties",
    });
  } else if (
    node.additionalProperties !== undefined &&
    node.additionalProperties !== true &&
    node.additionalProperties !== false
  ) {
    for (const key of extras) {
      collectErrors(
        node.additionalProperties,
        value[key],
        `${instancePath}/${escapePointer(key)}`,
        `${schemaPath}/additionalProperties`,
        issues,
      );
    }
  }
}

function collectArrayErrors(
  node: Record<string, any>,
  value: unknown[],
  instancePath: string,
  schemaPath: string,
  issues: ValidationIssue[],
): void {
  if (node.minItems !== undefined && value.length < Number(node.minItems)) {
    issues.push({
      keyword: "minItems",
      schemaPath,
      instancePath,
      params: { limit: Number(node.minItems) },
      message: `must not have fewer than ${Number(node.minItems)} items`,
    });
  }
  if (node.maxItems !== undefined && value.length > Number(node.maxItems)) {
    issues.push({
      keyword: "maxItems",
      schemaPath,
      instancePath,
      params: { limit: Number(node.maxItems) },
      message: `must not have more than ${Number(node.maxItems)} items`,
    });
  }
  if (node.uniqueItems === true) {
    const duplicates = duplicateItems(value);
    if (duplicates.length > 0) {
      issues.push({
        keyword: "uniqueItems",
        schemaPath,
        instancePath,
        params: { duplicateItems: duplicates },
        message: "must not have duplicate items",
      });
    }
  }

  const prefix = Array.isArray(node.prefixItems)
    ? (node.prefixItems as unknown[])
    : Array.isArray(node.items)
      ? (node.items as unknown[])
      : undefined;
  if (prefix !== undefined) {
    const isPrefix = Array.isArray(node.prefixItems);
    for (let index = 0; index < prefix.length && index < value.length; index++) {
      collectErrors(
        prefix[index],
        value[index],
        `${instancePath}/${index}`,
        isPrefix ? `${schemaPath}/prefixItems/${index}` : `${schemaPath}/items`,
        issues,
      );
    }
    if (isPrefix) {
      if (node.items === false && value.length > prefix.length) {
        issues.push({
          keyword: "items",
          schemaPath: `${schemaPath}/items`,
          instancePath: `${instancePath}/${prefix.length}`,
          params: { limit: prefix.length },
          message: `must not have more than ${prefix.length} items`,
        });
      } else if (node.items !== undefined && node.items !== true) {
        for (let index = prefix.length; index < value.length; index++) {
          collectErrors(
            node.items,
            value[index],
            `${instancePath}/${index}`,
            `${schemaPath}/items`,
            issues,
          );
        }
      }
    } else if (node.additionalItems === false) {
      if (value.length > prefix.length) {
        issues.push({
          keyword: "boolean",
          schemaPath: `${schemaPath}/additionalItems`,
          instancePath: `${instancePath}/${prefix.length}`,
          params: {},
          message: "schema is false",
        });
      }
    } else if (node.additionalItems !== undefined && node.additionalItems !== true) {
      for (let index = prefix.length; index < value.length; index++) {
        collectErrors(
          node.additionalItems,
          value[index],
          `${instancePath}/${index}`,
          `${schemaPath}/additionalItems`,
          issues,
        );
      }
    }
  } else if (node.items !== undefined && node.items !== true) {
    if (node.items === false) {
      if (value.length > 0) {
        issues.push({
          keyword: "items",
          schemaPath: `${schemaPath}/items`,
          instancePath,
          params: { limit: 0 },
          message: "must not have more than 0 items",
        });
      }
    } else {
      for (let index = 0; index < value.length; index++) {
        collectErrors(
          node.items,
          value[index],
          `${instancePath}/${index}`,
          `${schemaPath}/items`,
          issues,
        );
      }
    }
  }
}

function safeRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern);
  } catch {
    return /(?:)/;
  }
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

// ─── Conversion ─────────────────────────────────────────────────────────────

function convert(schema: unknown, value: unknown): unknown {
  if (schema === false || schema === null || typeof schema !== "object") return value;
  const node = schema as Record<string, any>;

  if (node.const !== undefined) return value;
  if (Array.isArray(node.enum)) return value;

  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    if (checkSchema(node, value)) return value;
    for (const member of (node.anyOf ?? node.oneOf) as unknown[]) {
      const candidate = convert(member, clone(value));
      if (checkSchema(node, candidate)) return candidate;
    }
    return value;
  }

  if (Array.isArray(node.allOf)) {
    for (const member of node.allOf) value = convert(member, value);
    return value;
  }

  switch (node.type) {
    case "number":
      return convertNumber(value, false);
    case "integer":
      return convertNumber(value, true);
    case "boolean":
      return convertBoolean(value);
    case "string":
      return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
    case "array":
      return convertArray(node, value);
    case "object":
      return convertObject(node, value);
    default:
      return value;
  }
}

function convertNumber(value: unknown, integer: boolean): unknown {
  let result: number;
  if (typeof value === "number") {
    result = value;
  } else if (typeof value === "boolean") {
    result = value ? 1 : 0;
  } else if (typeof value === "string" && value.trim() !== "") {
    result = Number(value);
    if (Number.isNaN(result)) return value;
  } else {
    return value;
  }
  return integer ? Math.trunc(result) : result;
}

function convertBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true" || value === "1") return true;
    if (lower === "false" || value === "0") return false;
  }
  return value;
}

function convertArray(node: Record<string, any>, value: unknown): unknown {
  const array = Array.isArray(value) ? value : [value];
  const prefix = Array.isArray(node.prefixItems)
    ? (node.prefixItems as unknown[])
    : Array.isArray(node.items)
      ? (node.items as unknown[])
      : undefined;
  if (prefix !== undefined) {
    for (let index = 0; index < prefix.length && index < array.length; index++) {
      array[index] = convert(prefix[index], array[index]);
    }
    const rest = Array.isArray(node.prefixItems) ? node.items : node.additionalItems;
    if (rest !== undefined && rest !== false && rest !== true) {
      for (let index = prefix.length; index < array.length; index++) {
        array[index] = convert(rest, array[index]);
      }
    }
  } else if (node.items !== undefined && node.items !== false) {
    for (let index = 0; index < array.length; index++) {
      array[index] = convert(node.items, array[index]);
    }
  }
  return array;
}

function convertObject(node: Record<string, any>, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(properties)) {
    if (object[key] === undefined) continue;
    object[key] = convert(properties[key], object[key]);
  }
  const patterns = (node.patternProperties ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(object)) {
    if (properties[key] === undefined) {
      for (const [pattern, child] of Object.entries(patterns)) {
        if (safeRegex(pattern).test(key)) object[key] = convert(child, object[key]);
      }
      if (
        node.additionalProperties !== undefined &&
        node.additionalProperties !== false &&
        node.additionalProperties !== true
      ) {
        object[key] = convert(node.additionalProperties, object[key]);
      }
    }
  }
  return object;
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to a shallow clone for values structuredClone rejects.
    }
  }
  return Array.isArray(value) ? ([...value] as T) : ({ ...(value as object) } as T);
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== typeof right) return false;
  if (typeof left !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left)) {
    const other = right as unknown[];
    if (left.length !== other.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!deepEqual(left[index], other[index])) return false;
    }
    return true;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function uniqueItems(value: unknown[]): boolean {
  for (let index = 0; index < value.length; index++) {
    for (let other = index + 1; other < value.length; other++) {
      if (deepEqual(value[index], value[other])) return false;
    }
  }
  return true;
}

function duplicateItems(value: unknown[]): unknown[] {
  const duplicates: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    for (let other = index + 1; other < value.length; other++) {
      if (!deepEqual(value[index], value[other])) continue;
      if (!duplicates.some((entry) => deepEqual(entry, value[index]))) {
        duplicates.push(value[index]);
      }
    }
  }
  return duplicates;
}
