import type { ProblemDocument } from "../contract/types";

export type BodyFormat = "json" | "form" | "multipart" | "raw";

export interface RetryConfig {
  times: number;
  sleep?: number | number[] | ((attempt: number, error: unknown) => number);
  when?: (error: unknown, request: Request) => boolean;
  throw?: boolean;
}

export interface HttpClientOptions {
  baseUrl?: string;
  headers?: HeadersInit;
  token?: string;
  basicAuth?: { username: string; password: string };
  timeout?: number;
  connectTimeout?: number;
  retry?: RetryConfig;
  fetch?: typeof globalThis.fetch;
}

export type RequestMiddlewareFn = (req: Request) => Request | Promise<Request>;
export type ResponseMiddlewareFn = (res: Response) => Response | Promise<Response>;

export type FakeBody = string | object;
export type FakeResponder = (req: Request) => Response | Promise<Response>;

export type { ProblemDocument };
