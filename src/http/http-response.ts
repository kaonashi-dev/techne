import { RequestException } from "./exceptions";
import { parseProblemFromText } from "./internal";
import type { ProblemDocument } from "../contract/types";

export class HttpResponse {
  readonly raw: Response;
  private readonly _text: string;
  private readonly _problem: ProblemDocument | undefined;

  constructor(raw: Response, text: string) {
    this.raw = raw;
    this._text = text;
    this._problem = parseProblemFromText(text, raw.headers.get("content-type") ?? "");
  }

  status(): number {
    return this.raw.status;
  }
  statusText(): string {
    return this.raw.statusText;
  }
  body(): string {
    return this._text;
  }

  json<T = unknown>(key?: string): T {
    const parsed = JSON.parse(this._text) as unknown;
    if (!key) return parsed as T;
    const parts = key.split(".");
    let val: unknown = parsed;
    for (const part of parts) {
      if (val === null || typeof val !== "object") return undefined as T;
      val = (val as Record<string, unknown>)[part];
    }
    return val as T;
  }

  object<T = unknown>(): T {
    return JSON.parse(this._text) as T;
  }

  headers(): Headers {
    return this.raw.headers;
  }
  header(name: string): string | null {
    return this.raw.headers.get(name);
  }

  ok(): boolean {
    return this.raw.status >= 200 && this.raw.status < 300;
  }
  successful(): boolean {
    return this.ok();
  }
  redirect(): boolean {
    return this.raw.status >= 300 && this.raw.status < 400;
  }
  failed(): boolean {
    return this.clientError() || this.serverError();
  }
  clientError(): boolean {
    return this.raw.status >= 400 && this.raw.status < 500;
  }
  serverError(): boolean {
    return this.raw.status >= 500;
  }

  created(): boolean {
    return this.raw.status === 201;
  }
  accepted(): boolean {
    return this.raw.status === 202;
  }
  noContent(): boolean {
    return this.raw.status === 204;
  }
  movedPermanently(): boolean {
    return this.raw.status === 301;
  }
  found(): boolean {
    return this.raw.status === 302;
  }
  notModified(): boolean {
    return this.raw.status === 304;
  }
  badRequest(): boolean {
    return this.raw.status === 400;
  }
  unauthorized(): boolean {
    return this.raw.status === 401;
  }
  paymentRequired(): boolean {
    return this.raw.status === 402;
  }
  forbidden(): boolean {
    return this.raw.status === 403;
  }
  notFound(): boolean {
    return this.raw.status === 404;
  }
  requestTimeout(): boolean {
    return this.raw.status === 408;
  }
  conflict(): boolean {
    return this.raw.status === 409;
  }
  unprocessableEntity(): boolean {
    return this.raw.status === 422;
  }
  tooManyRequests(): boolean {
    return this.raw.status === 429;
  }
  internalServerError(): boolean {
    return this.raw.status === 500;
  }
  serviceUnavailable(): boolean {
    return this.raw.status === 503;
  }

  toException(): RequestException | undefined {
    if (!this.failed()) return undefined;
    return new RequestException(this, this._problem);
  }

  throw(cb?: (res: HttpResponse, e: RequestException) => void): this {
    if (this.failed()) {
      const e = new RequestException(this, this._problem);
      if (cb) cb(this, e);
      throw e;
    }
    return this;
  }

  throwIf(condition: boolean | ((res: HttpResponse) => boolean)): this {
    const should = typeof condition === "function" ? condition(this) : condition;
    if (should) throw new RequestException(this, this._problem);
    return this;
  }

  throwUnless(condition: boolean | ((res: HttpResponse) => boolean)): this {
    const should = typeof condition === "function" ? condition(this) : condition;
    if (!should) throw new RequestException(this, this._problem);
    return this;
  }

  throwIfStatus(code: number): this {
    if (this.raw.status === code) throw new RequestException(this, this._problem);
    return this;
  }

  throwUnlessStatus(code: number): this {
    if (this.raw.status !== code) throw new RequestException(this, this._problem);
    return this;
  }

  throwIfClientError(): this {
    if (this.clientError()) throw new RequestException(this, this._problem);
    return this;
  }

  throwIfServerError(): this {
    if (this.serverError()) throw new RequestException(this, this._problem);
    return this;
  }

  onError(cb: (res: HttpResponse) => void): this {
    if (this.failed()) cb(this);
    return this;
  }
}
