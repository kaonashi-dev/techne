type AppLike = { handle: (req: Request) => Promise<Response> };

export interface JsonResult<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

const BASE = "http://localhost";

async function send<T>(app: AppLike, req: Request): Promise<JsonResult<T>> {
  const res = await app.handle(req);
  const text = await res.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body: body as T, headers: res.headers };
}

export function getJson<T = unknown>(
  app: AppLike,
  path: string,
  init?: RequestInit,
): Promise<JsonResult<T>> {
  return send<T>(app, new Request(`${BASE}${path}`, { method: "GET", ...init }));
}

export function postJson<T = unknown>(
  app: AppLike,
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<JsonResult<T>> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return send<T>(
    app,
    new Request(`${BASE}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      ...init,
      headers,
    }),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
