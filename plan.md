# Techne HTTP Client — Laravel-style `fetch` wrapper (`@kaonashi-dev/techne/http`)

**Status: PLANNED.** New first-class module that gives the framework an expressive, fluent
outgoing HTTP client modeled on [Laravel's HTTP Client](https://laravel.com/docs/13.x/http-client),
built as a thin wrapper over the native `fetch`. Full Laravel parity (requests, fluent
configuration, response inspection, error handling, retries/timeouts, concurrency,
preconfigured clients/macros, middleware, and a testing/fake layer).

> This plan **replaces** the prior (completed) Security Hardening Roadmap, which remains in git
> history (`ac3d8d3 docs: mark security roadmap complete in plan.md`).

---

## Context

Techne already ships `src/contract` — a **typed RPC client** (`createClient<RouteMap>()`) for
calling *known* routes of a Techne app by path key. It is great for app-to-app typed calls but is
deliberately narrow: you must model every route in a `RouteMap`, and it throws on any non-2xx.

What's missing is a **general-purpose outgoing HTTP client** for arbitrary third-party URLs
(GitHub, Stripe, internal microservices, webhooks) with an ergonomic, chainable DX. Today a
developer drops down to raw `fetch` and re-writes header/query/body/error plumbing every time.

The goal: a `Http` facade you **import and use directly, like a service of the app** —
`Http.withToken(t).acceptJson().get(url)` — plus `createHttpClient(options)` for reusable,
preconfigured clients. It must reuse the proven helpers already living in `src/contract/client.ts`
(query-string building, header merging, RFC 7807 parsing) and follow every existing module
convention so it feels native to the framework.

### Goals
- One-import ergonomic usage: `import { Http } from "@kaonashi-dev/techne/http"`.
- Reusable preconfigured clients via `createHttpClient({ baseUrl, headers, token, ... })`.
- Faithful Laravel surface: same method names and semantics wherever they map cleanly to `fetch`.
- **Does NOT throw on 4xx/5xx by default** (Laravel semantics); explicit `throw()` opt-in.
- First-class testability (`Http.fake()`, `assertSent`, `preventStrayRequests`).

### Non-goals / explicit omissions (with rationale)
- `withDigestAuth` — digest challenge/response isn't expressible over `fetch`; **omitted** (Basic + Bearer supported).
- Guzzle-specific `withOptions` keys (e.g. `debug`, `allow_redirects` proxy opts) — replaced by passing a raw `RequestInit` through `withOptions()`.
- Batch `defer()` (Laravel runs deferred batches after the HTTP response is flushed) — that's a server-request-lifecycle feature with no analogue in a standalone client; `batch()` is provided **without** `defer()`.
- URI-template `withUrlParameters` — supported as a **minimal** `{var}` / `{+var}` expander only (not the full RFC 6570 operator set).

---

## Conventions (mirroring the existing codebase)

- **Module location:** all code in `src/http/`, kebab-case filenames, `PascalCase` classes, `UPPER_SNAKE_CASE` tokens — matches `src/jwt`, `src/security`, `src/contract`.
- **Public surface:** a barrel `src/http/index.ts` + a `"./http"` subpath in `package.json` `exports`, mirroring the existing `"./contract"` entry exactly.
- **Errors:** the client throws its **own** `RequestException` / `ConnectionException` (these are *outgoing-call* failures and are unrelated to the server-side `HttpException`/RFC 7807 `mapException` path). When the remote returns RFC 7807, we parse it into `RequestException.problem` using the same shape as `ProblemDocument`.
- **Reuse, don't reinvent:** copy the four tiny *pure* helpers from `src/contract/client.ts` into `src/http/internal.ts` (they are currently private to that file) and **import the `ProblemDocument` type from `../contract/types`** (already public) so the wire shape stays identical. The contract module is left untouched to avoid regression risk; a future cleanup can hoist these into a shared util.
- **Tests:** `tests/http-*.test.ts`, run with `bun test`. Reuse the `makeFetch()` injected-`fetch` mock pattern from `tests/contract-client.test.ts` for engine tests; use the new `Http.fake()` for the testing-layer tests.
- **Units (Laravel parity, documented inline):** `timeout(seconds)` / `connectTimeout(seconds)` are in **seconds**; `retry(times, sleepMs)` sleep is in **milliseconds**.

---

## Architecture

```
src/http/
├── index.ts            # barrel: Http, createHttpClient, classes, types, testing utils
├── factory.ts          # `Http` (Proxy facade) + createHttpClient() + global config + macros
├── pending-request.ts  # PendingRequest — fluent builder + send() engine (retry/timeout)
├── http-response.ts    # HttpResponse — buffered, sync inspectors + throw helpers
├── exceptions.ts       # RequestException, ConnectionException
├── pool.ts             # pool() + batch() concurrency
├── fake.ts             # fake/response/sequence + assertions + preventStrayRequests
├── internal.ts         # reused pure helpers (query/headers/baseUrl/problem)
└── types.ts            # HttpClientOptions, RetryConfig, BodyFormat, RecordedRequest, etc.
```

**Request flow (`PendingRequest.send`):**
1. Resolve URL: join `baseUrl` + path, expand `{var}` url params, append merged query string (`buildQueryString`).
2. Build headers: defaults → `accept`/content-type (from body format) → auth → per-call. (`mergeHeaders`)
3. Build body by format: `json` → `JSON.stringify`; `form` → `URLSearchParams`; `multipart` → `FormData` (+ `attach`ments, let `fetch` set the boundary); `body` → raw with explicit content-type.
4. Build a native `Request`; run **request middleware** (per-request + global).
5. Wrap with timeout (`AbortSignal.timeout(seconds*1000)`, combined with any caller signal).
6. **Resolve fetch implementation** in this order: active **fake** (if installed and not bypassed) → client/`withOptions` injected `fetch` → `globalThis.fetch`.
7. Retry loop: on `ConnectionException` or a "retryable" response, sleep + retry up to `times`; record the request/response for the fake layer.
8. Run **response middleware**, buffer the body once, return `HttpResponse`. (Throwing is opt-in via `HttpResponse.throw()` or `retry(..., throw: true)`.)

---

## Phase 1 — Core engine (`PendingRequest`, `HttpResponse`, exceptions)

**Files:** create `src/http/internal.ts`, `src/http/types.ts`, `src/http/exceptions.ts`,
`src/http/http-response.ts`, `src/http/pending-request.ts`.

**`internal.ts`** — copy verbatim from `src/contract/client.ts`: `buildQueryString`, `mergeHeaders`,
`normalizeBaseUrl`, `parseProblem`, `isPlainObject`. `import type { ProblemDocument } from "../contract/types"`.

**`exceptions.ts`:**
```ts
export class RequestException extends Error {
  readonly response: HttpResponse;
  readonly status: number;
  readonly problem?: ProblemDocument;          // parsed RFC 7807, when present
  constructor(response: HttpResponse);          // message = problem?.title ?? `HTTP request returned status ${status}` (truncated to 120 chars)
}
export class ConnectionException extends Error {  // network failure / timeout / abort
  readonly cause?: unknown;
}
```

**`http-response.ts`** — wraps a native `Response` with its body **pre-buffered as text** (so
inspectors are synchronous like Laravel):
```ts
class HttpResponse {
  status(): number;  statusText(): string;
  body(): string;  json<T = unknown>(key?: string): T;  object<T = unknown>(): T;
  headers(): Headers;  header(name: string): string | null;
  successful(): boolean; ok(): boolean; redirect(): boolean;
  failed(): boolean; clientError(): boolean; serverError(): boolean;
  created(): boolean; accepted(): boolean; noContent(): boolean;
  unauthorized(): boolean; forbidden(): boolean; notFound(): boolean;
  unprocessableEntity(): boolean; tooManyRequests(): boolean;     // + the rest of Laravel's helpers
  throw(cb?: (res, e) => void): this;  throwIf(c): this;  throwUnless(c): this;
  throwIfStatus(code): this;  throwUnlessStatus(code): this;
  throwIfClientError(): this;  throwIfServerError(): this;
  onError(cb: (res) => void): this;
  toException(): RequestException | undefined;
  readonly raw: Response;     // escape hatch to the native Response (already-consumed body)
}
```
`json(key?)` supports an optional dot-path (`json("data.id")`) like Laravel's `$response->json('x.y')`.

**`pending-request.ts`** — the fluent builder. Mutating fluent methods return `this` (Laravel
semantics). Phase-1 subset of fluent methods:
`baseUrl, withHeaders, withHeader, replaceHeaders, accept, acceptJson, contentType, withToken,
withBasicAuth, asJson, asForm, asMultipart, attach, withBody, withQueryParameters,
withUrlParameters, withOptions`. Terminal methods returning `Promise<HttpResponse>`:
`get(url, query?), head(url), post(url, data?), put(url, data?), patch(url, data?),
delete(url, data?), send(method, url, opts?)`. (Timeout/retry/middleware land in later phases but
the `send()` skeleton is built here.)

**Design:** `withToken(t, type="Bearer")` → `Authorization: Bearer t`; `withBasicAuth` →
`Authorization: Basic base64(user:pass)`. Default body format is `json`. `data` for `get` merges
into the query string; `data` for body methods becomes the request body per format.

**Tests** (`tests/http-client.test.ts`, `makeFetch` pattern): GET with array query expansion; POST
JSON sets `content-type` + stringifies; `asForm` → urlencoded; `asMultipart`/`attach` → `FormData`;
`withBody` raw + content-type; `withToken`/`withBasicAuth` set `Authorization`; `withHeaders` merge
vs `replaceHeaders`; `baseUrl` join + `withUrlParameters` expansion; response inspectors
(`status/ok/successful/failed/clientError/serverError/json/body/header`); **no throw on 4xx by
default**; `throw()` raises `RequestException` carrying the response + parsed `problem`;
`throwIf/throwUnless/throwIfStatus`.

**Risks:** native `Response` body is one-shot — buffer text exactly once (after response middleware)
and back `json()`/`body()` from it.

---

## Phase 2 — Timeout & retries

**File:** extend `pending-request.ts`; add `RetryConfig` to `types.ts`.

**API:** `timeout(seconds)`, `connectTimeout(seconds)`,
`retry(times, sleep?, when?, opts?)` where `sleep` is `number` (ms) | `number[]` |
`(attempt, error) => number`, `when?: (error, request) => boolean`, and `opts?: { throw?: boolean }`
(default `throw: true` → throws `RequestException` after exhausting retries; `throw: false` returns
the last `HttpResponse`).

**Design:** timeout via `AbortSignal.timeout(seconds*1000)` merged with a caller-supplied signal;
an abort/network error becomes `ConnectionException`. The retry loop retries on `ConnectionException`
and on responses where `when` (default: `failed()`) returns true. `when` also receives the request
so a token can be refreshed mid-retry (Laravel's 401→refresh pattern). **Note:** `fetch` has no
separate connect phase — `connectTimeout` is accepted for parity and folded into the overall
deadline (documented).

**Tests:** retries N times then succeeds; `when` predicate limits retries; `throw: false` returns
last response; timeout rejects → `ConnectionException`; array-backoff sleeps per entry (assert via a
fake clock / injected sleeper).

**Risks:** keep real wall-clock sleeps out of tests — inject the sleeper (`opts.sleeper` internal seam).

---

## Phase 3 — `Http` facade, preconfigured clients & global config

**File:** `src/http/factory.ts`.

**`createHttpClient(options)`** returns a client object exposing the **same** fluent entrypoints +
terminal methods, each seeding a fresh `PendingRequest` from the client's defaults:
```ts
interface HttpClientOptions {
  baseUrl?: string;
  headers?: HeadersInit;
  token?: string;                 // bearer
  basicAuth?: { username: string; password: string };
  timeout?: number;               // seconds
  retry?: RetryConfig;
  fetch?: typeof globalThis.fetch; // injectable (tests / custom transport)
}
const github = createHttpClient({ baseUrl: "https://api.github.com", token: env.GH });
const repos = await github.acceptJson().get("/user/repos");
```
This is the **"use it like a service"** path: define `src/services/github.client.ts`, export the
instance, import it anywhere.

**`Http` facade** = a default client (`createHttpClient({})`) wrapped in a **`Proxy`** so that
registered **macros** resolve as methods (Laravel's `Http::github()`):
```ts
Http.macro("github", () => Http.withToken(env.GH).baseUrl("https://api.github.com"));
const res = await Http.github().get("/user");
```
The `Proxy` `get` trap: known method → bound facade method; else registered macro → its factory;
else `undefined`. The facade also hosts global config: `Http.globalOptions(RequestInit)`,
`Http.globalRequestMiddleware(fn)`, `Http.globalResponseMiddleware(fn)`.

**Tests:** `createHttpClient` bakes baseUrl/headers/token into every call; per-call overrides win;
`Http.get(...)` shorthand works; `Http.macro` registration + invocation; `globalOptions` merged into
requests.

---

## Phase 4 — Concurrency (`pool`, `batch`)

**File:** `src/http/pool.ts`.

**API:**
```ts
const responses = await Http.pool((p) => [ p.get(a), p.get(b), p.as("third").get(c) ], { concurrency: 5 });
responses[0].ok(); responses["third"].ok();
```
`pool(cb, opts?)` — `cb` receives a `Pool` whose `get/post/...` return **deferred** request
descriptors (not yet executed); `as(name)` keys a result. Returns an array (with named keys mixed in)
resolved with a concurrency limiter (default unbounded). `batch(cb)` layers
`.before/.progress/.then/.catch/.finally/.concurrency(n)/.send()` over the same primitive
(**no** `defer()` — see Non-goals).

**Design:** each `Pool` method captures a configured `PendingRequest` and returns
`() => Promise<HttpResponse>`; a small async pool runner enforces `concurrency`.

**Tests:** all requests dispatched concurrently; positional + named access; `concurrency` cap
respected (assert max in-flight via instrumented fetch); `batch` lifecycle callbacks fire in order.

---

## Phase 5 — Middleware

**File:** extend `pending-request.ts` + `factory.ts`.

**API:** `withRequestMiddleware((req: Request) => Request | Promise<Request>)`,
`withResponseMiddleware((res: Response) => Response | Promise<Response>)`, plus global
`Http.globalRequestMiddleware` / `Http.globalResponseMiddleware`. We operate on the native
`Request`/`Response` (the natural analogue of Laravel's PSR-7 middleware).

**Design:** global middleware runs first, then per-request, in registration order. Request
middleware runs after the body/headers are assembled (step 4); response middleware runs before the
body is buffered (step 8).

**Tests:** request middleware injects an outgoing header (assert received); response middleware
rewrites/inspects a header; global vs per-request ordering.

---

## Phase 6 — Testing layer (`fake`, assertions, stray-request guard)

**File:** `src/http/fake.ts` (module-level mutable state on the facade).

**API:**
```ts
Http.fake();                                   // every request → empty 200
Http.fake({ "github.com/*": Http.response({ foo: "bar" }, 200),
            "google.com/*": "Hello", "*": 200 });
Http.fake((req) => Http.response("Hi", 200));  // closure
Http.response(body?, status=200, headers?);    // string | object(JSON) | number(status)
Http.sequence().push(body, status).pushStatus(404).whenEmpty(Http.response());
Http.fakeSequence();                           // sequence applied to all URLs
Http.preventStrayRequests();  Http.allowStrayRequests(["http://127.0.0.1:*"]);
Http.assertSent((req) => boolean);  Http.assertNotSent(fn);
Http.assertSentCount(n);  Http.assertNothingSent();
Http.recorded((req, res) => boolean);          // → [request, response][]
```

**Design:** when a fake is installed, `send()` resolves the fetch impl to the fake matcher
(URL-glob `*` wildcards), records `{ request, response }`, and returns the stub; unmatched +
`preventStrayRequests` (and not in `allowStrayRequests`) → throw. Recorded requests are wrapped in a
`RecordedRequest` exposing `url()`, `method()`, `hasHeader(name, value?)`, `header(name)`, `body()`,
`data()`/`["key"]` for assertions. `Http.fake()` (or `Http.fakeReset()`) clears all state — call in
`beforeEach`.

**Tests** (`tests/http-client-fake.test.ts`): empty-200 default; URL-map + wildcard fallback;
closure responder; `sequence`/`whenEmpty`; `assertSent`/`assertNotSent`/`assertSentCount`/
`assertNothingSent`; `recorded()` filter; `preventStrayRequests` throws on unmatched and
`allowStrayRequests` lets a pattern through.

---

## Phase 7 — Packaging, docs & verification

**Files:** `src/http/index.ts` (barrel), `package.json` (add export), `README.md` (usage snippet).

**Barrel** exports `Http`, `createHttpClient`, `PendingRequest`, `HttpResponse`,
`RequestException`, `ConnectionException`, all public types, and the testing helpers — with a header
comment matching `src/contract/index.ts`.

**`package.json` export** (insert after `"./contract"`, exact shape of existing entries):
```json
"./http": {
  "bun": "./src/http/index.ts",
  "import": "./src/http/index.ts",
  "types": "./dist/types/http/index.d.ts"
}
```

**README:** short "HTTP Client" section with the `Http.withToken(...).get(...)` and
`createHttpClient(...)` service-style examples.

---

## Reused machinery

| Utility | Source | Use in `src/http` |
|---|---|---|
| `buildQueryString` (array → repeated keys) | `src/contract/client.ts` | URL query assembly (copied into `internal.ts`) |
| `mergeHeaders` | `src/contract/client.ts` | header precedence (defaults → per-call) |
| `normalizeBaseUrl` | `src/contract/client.ts` | trim trailing slash on `baseUrl` |
| `parseProblem` | `src/contract/client.ts` | parse RFC 7807 into `RequestException.problem` |
| `ProblemDocument` type | `src/contract/types.ts` (imported) | shared wire shape — **not** re-declared |
| `makeFetch()` mock pattern | `tests/contract-client.test.ts` | engine tests inject `fetch` |
| `TechneFactory.create` + `app.handle` | `tests/*.test.ts` | optional round-trip smoke vs a local app |

---

## Verification

1. `bun install --frozen-lockfile` first (avoids the known `Cannot find package 'elysia'` link breakage).
2. `bun test tests/http-client*.test.ts` — new suites green.
3. `bun run test` — **full** suite stays green (no regressions in `contract`, since it is untouched).
4. `bun run check` — `oxlint` + `oxfmt --check` clean.
5. `bun run build` (`tsc -p tsconfig.build.json`) — confirms the `./http` subpath emits
   `dist/types/http/index.d.ts` and the public types resolve.
6. **Manual smoke** — a throwaway `bun run` script:
   - offline: `Http.fake({ "*": Http.response({ ok: true }) }); Http.assertSentCount(...)`.
   - online (optional): `await Http.acceptJson().get("https://httpbin.org/get")` → assert `res.ok()` and `res.json()`.

---

## Progress

- [x] Phase 1 — Core engine (`PendingRequest`, `HttpResponse`, exceptions, `internal.ts`)
- [x] Phase 2 — Timeout & retries
- [x] Phase 3 — `Http` facade, `createHttpClient`, macros, global config
- [x] Phase 4 — Concurrency (`pool`, `batch`)
- [x] Phase 5 — Middleware (per-request + global)
- [x] Phase 6 — Testing layer (`fake`, assertions, stray-request guard)
- [x] Phase 7 — Packaging, docs, verification
