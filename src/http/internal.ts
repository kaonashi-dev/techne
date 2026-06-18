import type { ProblemDocument } from "../contract/types";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function buildQueryString(query: unknown): string {
  if (!query || !isPlainObject(query)) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        params.append(key, String(item));
      }
      continue;
    }
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.length > 1 && baseUrl.endsWith("/")) return baseUrl.slice(0, -1);
  return baseUrl;
}

export function mergeHeaders(...inits: (HeadersInit | undefined)[]): Headers {
  const merged = new Headers();
  for (const init of inits) {
    if (!init) continue;
    new Headers(init).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

export function parseProblemFromText(
  text: string,
  contentType: string,
): ProblemDocument | undefined {
  const isProblem =
    contentType.includes("application/problem+json") || contentType.includes("application/json");
  if (!isProblem) return undefined;
  try {
    const body = JSON.parse(text) as ProblemDocument;
    if (body && typeof body === "object" && typeof body.title === "string") return body;
    return undefined;
  } catch {
    return undefined;
  }
}

/** Expand {var} and {+var} URI template placeholders (minimal RFC 6570 subset). */
export function expandUrlTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\+?)([A-Za-z0-9_]+)\}/g, (_match, plus, name: string) => {
    const value = params[name];
    if (value === undefined) return `{${plus}${name}}`;
    return plus ? value : encodeURIComponent(value);
  });
}
