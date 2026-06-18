import { HttpResponse } from "./http-response";
import { PendingRequest } from "./pending-request";
import type { HttpClientOptions } from "./types";

type PoolResult = HttpResponse[] & Record<string, HttpResponse>;

interface Descriptor {
  index: number;
  key?: string;
  thunk: () => Promise<HttpResponse>;
}

// ─── Pool ──────────────────────────────────────────────────────────────────

export class Pool {
  readonly _descriptors: Descriptor[] = [];

  constructor(private readonly _options: HttpClientOptions = {}) {}

  as(name: string): PoolStep {
    return new PoolStep(this, name);
  }

  _add(thunk: () => Promise<HttpResponse>, key?: string): () => Promise<HttpResponse> {
    this._descriptors.push({ index: this._descriptors.length, key, thunk });
    return thunk;
  }

  get(url: string, query?: Record<string, unknown>): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).get(url, query));
  }

  head(url: string): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).head(url));
  }

  post(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).post(url, data));
  }

  put(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).put(url, data));
  }

  patch(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).patch(url, data));
  }

  delete(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._add(() => new PendingRequest(this._options).delete(url, data));
  }

  async _run(concurrency = 0): Promise<PoolResult> {
    return runWithConcurrency(this._descriptors, concurrency);
  }
}

// ─── PoolStep (fluent named entry) ────────────────────────────────────────

export class PoolStep {
  constructor(
    private readonly _pool: Pool,
    private readonly _name: string,
  ) {}

  get(url: string, query?: Record<string, unknown>): () => Promise<HttpResponse> {
    return this._pool._add(
      () => new PendingRequest(this._pool["_options"]).get(url, query),
      this._name,
    );
  }

  head(url: string): () => Promise<HttpResponse> {
    return this._pool._add(() => new PendingRequest(this._pool["_options"]).head(url), this._name);
  }

  post(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._pool._add(
      () => new PendingRequest(this._pool["_options"]).post(url, data),
      this._name,
    );
  }

  put(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._pool._add(
      () => new PendingRequest(this._pool["_options"]).put(url, data),
      this._name,
    );
  }

  patch(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._pool._add(
      () => new PendingRequest(this._pool["_options"]).patch(url, data),
      this._name,
    );
  }

  delete(url: string, data?: unknown): () => Promise<HttpResponse> {
    return this._pool._add(
      () => new PendingRequest(this._pool["_options"]).delete(url, data),
      this._name,
    );
  }
}

// ─── Batch ────────────────────────────────────────────────────────────────

export class Batch {
  private _beforeFn: (() => void) | null = null;
  private _progressFn: ((res: HttpResponse, idx: number) => void) | null = null;
  private _thenFn: ((responses: PoolResult) => void) | null = null;
  private _catchFn: ((err: unknown) => void) | null = null;
  private _finallyFn: (() => void) | null = null;
  private _concurrencyN = 0;

  constructor(private readonly _descriptors: Descriptor[]) {}

  before(fn: () => void): this {
    this._beforeFn = fn;
    return this;
  }

  progress(fn: (res: HttpResponse, idx: number) => void): this {
    this._progressFn = fn;
    return this;
  }

  // eslint-disable-next-line unicorn/no-thenable
  then(fn: (responses: PoolResult) => void): this {
    this._thenFn = fn;
    return this;
  }

  catch(fn: (err: unknown) => void): this {
    this._catchFn = fn;
    return this;
  }

  finally(fn: () => void): this {
    this._finallyFn = fn;
    return this;
  }

  concurrency(n: number): this {
    this._concurrencyN = n;
    return this;
  }

  async send(): Promise<PoolResult> {
    if (this._beforeFn) this._beforeFn();
    try {
      const result = await runWithConcurrency(
        this._descriptors,
        this._concurrencyN,
        this._progressFn ?? undefined,
      );
      if (this._thenFn) this._thenFn(result);
      return result;
    } catch (err) {
      if (this._catchFn) this._catchFn(err);
      throw err;
    } finally {
      if (this._finallyFn) this._finallyFn();
    }
  }
}

// ─── Concurrency runner ───────────────────────────────────────────────────

async function runWithConcurrency(
  descriptors: Descriptor[],
  concurrency: number,
  onProgress?: (res: HttpResponse, idx: number) => void,
): Promise<PoolResult> {
  const results: HttpResponse[] = Array.from({ length: descriptors.length });

  const execute = async (i: number) => {
    results[i] = await descriptors[i]!.thunk();
    if (onProgress) onProgress(results[i]!, i);
  };

  if (concurrency <= 0 || concurrency >= descriptors.length) {
    await Promise.all(descriptors.map((_, i) => execute(i)));
  } else {
    let next = 0;
    const worker = async () => {
      while (next < descriptors.length) {
        await execute(next++);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, descriptors.length) }, worker));
  }

  const named: Record<string, HttpResponse> = {};
  for (const { index, key } of descriptors) {
    if (key !== undefined) named[key] = results[index]!;
  }

  return Object.assign(results, named) as PoolResult;
}
