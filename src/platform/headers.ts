/**
 * Shared merge helpers for Elysia's `set.headers`, which can be `null`, a
 * `Headers` instance, or a plain record depending on which hook touched it
 * first — every writer needs the same three-branch merge.
 */

export function applyHeader(set: any, name: string, value: string): void {
  const existing = set.headers;
  if (existing == null) {
    set.headers = { [name]: value };
  } else if (existing instanceof Headers) {
    existing.set(name, value);
  } else {
    (existing as Record<string, string>)[name] = value;
  }
}

export function applyHeaders(set: any, headers: Readonly<Record<string, string>>): void {
  const existing = set.headers;
  if (existing == null) {
    // Copy — the input is typically a shared boot-compiled record and later
    // hooks mutate `set.headers` in place.
    set.headers = { ...headers };
  } else if (existing instanceof Headers) {
    for (const name in headers) existing.set(name, headers[name]);
  } else {
    const record = existing as Record<string, string>;
    for (const name in headers) record[name] = headers[name];
  }
}
