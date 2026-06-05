export interface ParsedArgv {
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
}

/**
 * Tokens are argv AFTER the command name. Supports:
 * --k=v | --k v | -k v | --flag | --no-flag | repeated --k (→ string[]) | "--" stops option parsing.
 */
export function parseArgv(tokens: string[]): ParsedArgv {
  const positionals: string[] = [];
  const options: Record<string, string | boolean | string[]> = {};

  const set = (k: string, v: string | boolean) => {
    if (k in options) {
      const cur = options[k];
      options[k] = Array.isArray(cur) ? [...cur, String(v)] : [String(cur), String(v)];
    } else {
      options[k] = v;
    }
  };

  let onlyPositional = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (onlyPositional) {
      positionals.push(t);
      continue;
    }
    if (t === "--") {
      onlyPositional = true;
      continue;
    }
    if (t.startsWith("--")) {
      const body = t.slice(2);
      if (body.startsWith("no-")) {
        set(body.slice(3), false);
        continue;
      }
      const eq = body.indexOf("=");
      if (eq !== -1) {
        set(body.slice(0, eq), body.slice(eq + 1));
        continue;
      }
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        set(body, next);
        i++;
      } else {
        set(body, true);
      }
    } else if (t.startsWith("-") && t.length > 1) {
      const body = t.slice(1);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        set(body, next);
        i++;
      } else {
        set(body, true);
      }
    } else {
      positionals.push(t);
    }
  }

  return { positionals, options };
}
