# Security Hardening Roadmap — HTTP, Middleware, Validation

> Status: **Phase 1 in progress** on branch `feat/security-headers-and-server-limits`.
> Approved plan; phases ship as separate PRs in order P1 → P2 → P3 → P4 → P5
> (P3/P5 only need P1's option plumbing and can be developed in parallel with P2/P4).

## Context

The framework already has strong security foundations: automatic TypeBox validation for body/query/params with strict `additionalProperties: Never`, RFC 7807 problem+json errors that suppress internals in production, timing-safe JWT verification (HS256), guards, and CORS. But it lacks the standard production protections entirely: **no security headers, no HTTP rate limiting, no body-size limits or timeouts, no header validation, no upload validation, no cookie/CSRF support, and no runtime validation of queue payloads or console args**.

This roadmap closes those gaps in **5 PRs**. All four scope areas confirmed: core HTTP hardening, validation deepening, CSRF + cookies, internal input surfaces.

**Conventions for every phase** (verified against the code):

- Options via `TechneFactory.create({...})` following the `CorsOptions` idiom (`src/core/http-options.ts`, `src/factory/techne-factory.ts`); features compiled into fused hooks / route `beforeHandle` at boot — zero per-request cost when disabled (the codebase is performance-obsessed).
- New `src/security/` module with a `"./security"` subpath export in `package.json` (mirrors `./jwt`, `./mq`).
- **Critical constraint (verified):** the fused `onError` only maps `code === "VALIDATION"` (`src/platform/elysia-adapter.ts:405`). Thrown exceptions in `beforeHandle` middleware do NOT get RFC 7807 treatment. Middleware rejections must use the versioning-middleware idiom (`src/core/router/routes-resolver.ts:82-98`): `ctx.set.status = N; return body` — returning `RouterResponseController.mapException(ctx, exception)` for canonical problem+json.
- Descriptive PR titles/branch names (no plan codes). Run `bun install --frozen-lockfile` if tests fail with "Cannot find package 'elysia'".

---

## Phase 1 — Security headers + native body limit/timeout + client-IP foundation

**Files:** create `src/security/security-headers.ts`, `src/security/client-ip.ts`, `src/security/index.ts`, `src/platform/headers.ts` (shared `applyHeader`/`applyHeaders` merge helpers); modify `src/core/http-options.ts`, `src/factory/techne-factory.ts`, `src/platform/elysia-adapter.ts`, `src/core/techne-application.ts:204`, `package.json`, `README.md`. Tests: `tests/security-headers.test.ts`, `tests/server-options.test.ts`.

**API:**

```ts
TechneFactory.create({
  securityHeaders: true | SecurityHeadersOptions,  // preset: nosniff, X-Frame-Options SAMEORIGIN,
                                                   // HSTS 180d+subdomains, Referrer-Policy no-referrer,
                                                   // COOP/CORP same-origin; CSP opt-in; `custom` escape hatch
  server: { maxRequestBodySize?: number; idleTimeout?: number },  // → Bun.serve natively
});
resolveClientIp(ctx, trustProxy?: boolean | { header?, hops? })   // src/security/client-ip.ts
```

**Design:**

- Compile headers once at boot to a frozen record (the `compileCorsOptions` pattern, `elysia-adapter.ts:585-637`); apply in **both** fused `onAfterHandle` AND `onError` — error responses bypass `onAfterHandle` and need the headers most.
- Extract the duplicated 3-branch `set.headers` merge (currently in `echoRequestId`, `echoInboundRequestId`, CORS hook, and the 422 mapping) into shared `applyHeader`/`applyHeaders` helpers — P2/P4 reuse them. `applyHeaders` copies on the null branch so shared boot-compiled records are never mutated in place.
- Body limit/timeout: change `techne-application.ts:204` to object-form `listen({ port, ...serverOptions }, callback)` — Elysia forwards `Partial<Serve>` to `Bun.serve`. Prefer native enforcement (pre-parse 413, socket-level timeout) over reimplementation.
- `resolveClientIp`: default `ctx.server?.requestIP()`; consult `X-Forwarded-For` only when `trustProxy` explicitly enabled (rightmost-hops semantics). There is no trusted-proxy handling today — default off.

**Tests:** headers on 200/404/422/thrown-error responses; preset vs overrides vs per-header `false`; no headers when option absent (zero-cost contract); client-IP unit tests (XFF ignored without trustProxy); real-socket 413 test (`app.handle()` bypasses Bun.serve — must `listen` on ephemeral port).

**Risks:** HSTS over local HTTP (emit always — browsers ignore HSTS on plain HTTP; document). `idleTimeout` ≠ total handler deadline — defer `@Timeout(ms)` decorator, document distinction. Raw `Response` short-circuits (CORS preflight 204, draining 503) bypass the hooks — security headers intentionally absent there; Bun's native 413 is plain-text, not problem+json.

---

## Phase 2 — HTTP rate limiting

**Files:** create `src/security/rate-limit.ts`, `src/decorators/rate-limit.decorator.ts`, `tests/rate-limit.test.ts`; modify `src/core/http-options.ts`, `src/factory/techne-factory.ts`, `src/platform/elysia-adapter.ts`, `src/core/router/router-execution-context.ts` (`create()` ~362-441), `src/core/router/router-explorer.ts`, `docs/errors/too-many-requests.md`, `README.md`.

**API:**

```ts
TechneFactory.create({ rateLimit: { limit: 100, windowMs: 60_000, burst?, store?, keyExtractor?,
                                    trustProxy?, headers? /* default true */, exclude? } });
@RateLimit({ limit: 10, windowMs: 60_000 })  // method/controller override
@RateLimit(false)                            // exempt from global limiter

interface RateLimitStore { consume(key, policy): RateLimitDecision | Promise<RateLimitDecision> }
```

**Design:**

- **Global limiter** in fused `onRequest` (before routing/guards/body parsing); rejects with a direct `Response` (the draining-503 idiom, `elysia-adapter.ts:237-242`) carrying problem+json 429 + `Retry-After` + IETF `RateLimit-*` headers.
- **Per-route** hook prepended in `RouterExecutionContext.create`: `beforeHandle = [rateLimitHook?, guardHook?, ...middlewares]` — limiter shields JWT verification cost. Rejection via `set.status` + `responseController.mapException(ctx, new TooManyRequestsException(...))` (do NOT throw — see critical constraint).
- Default store: `InMemoryTokenBucketStore` — `Map<key, {tokens, lastRefillMs}>`, continuous refill, capacity `burst ?? limit`, LRU-capped at 10k entries (Map-reinsertion trick from the CORS dynamic-header cache). The MQ `RateLimited` middleware validates the token-bucket pattern but has MQ `release()` semantics — reuse the pattern, not the code. Pluggable `RateLimitStore` is the multi-instance/Redis extension point.
- Key: `resolveClientIp` from P1. No resolvable IP (`app.handle()` path) → fail-open + one-time warning. Compile sync vs async hook variant at boot based on store.

**Tests:** bucket math (refill/burst/exhaustion/key isolation); 429 problem+json body + headers; success-path `RateLimit-Remaining`; decorator override/exemption/controller inheritance; async store; XFF only with trustProxy; zero `beforeHandle` entries when disabled.

---

## Phase 3 — Validation deepening: header DTOs, strip-unknown, upload validation

**Files:** modify `src/decorators/params.decorator.ts`, `src/decorators/routes.decorator.ts` (`RouteSchema.headers`), `src/core/router/router-explorer.ts` (`resolveSchema` ~189-222), `src/platform/elysia-adapter.ts:512-517` (add `elysiaOptions.headers` — verified absent today), `src/schema/dto.ts`, `src/core/router/router-execution-context.ts` (file extractor ~140-152), `src/factory/techne-factory.ts`, `README.md`. Create `tests/header-dto-validation.test.ts`, `tests/upload-validation.test.ts`.

**API:**

```ts
@Dto() class AuthHeaders { @IsString() @MinLength(10) "x-api-key"!: string }  // lowercase quoted keys
handler(@Headers(AuthHeaders) h: AuthHeaders) {}

TechneFactory.create({ validation: { stripUnknown: true } });  // global; @Dto({ stripUnknown }) per-DTO override

@UploadedFile("avatar", { maxSize: 5_242_880, mimeTypes: ["image/png", "image/*"], required: true })
```

**Design:**

- **Header DTOs:** Elysia validates `headers` natively once the schema is injected; `ctx.headers` keys are lowercased so case-insensitivity is by construction. New `buildHeaderSchemaFromClass` in `dto.ts`: lowercases keys, **forces `additionalProperties: true`** (strict default would reject every request — headers always carry `host`, `accept`, …), cached in a separate `headerSchemaRegistry` so the strict body validator is untouched. Failures flow through the existing `code === "VALIDATION"` → 422 mapping for free.
- **Strip-unknown:** inject a lenient schema clone (`additionalProperties: true`, second cache — never mutate the compiled strict validator); prepend a boot-compiled step running `stripUnknownProperties(ctx.body, dtoClass)` (`dto.ts:291-296`, already same-ref fast path) before arg binding, only on affected routes. Per-DTO overrides global; both absent → identical code path to today. v1 = top-level only (document).
- **Uploads:** decorator options, not DTO. The `file` extractor is excluded from codegen fast path already, so wrapping it costs nothing for non-upload routes. Check `instanceof Blob`, `required`, `size`, MIME (exact + `type/*` wildcard); throw `UnprocessableEntityException` with DTO-style `errors` array — extractor throws DO route through `mapException`, unlike `beforeHandle`. `file.type` is client-declared; magic-byte sniffing out of scope (document).

**Tests:** header DTO valid/422/extra-headers-tolerated/case-insensitive (`X-API-Key` sent); strip-unknown global+per-DTO both directions, strict 422 preserved when off; uploads oversize/wrong-MIME/wildcard/required-missing; options-less `@UploadedFile` unchanged (`tests/swagger-health-upload.test.ts` must pass); `tests/openapi-emitter.test.ts` unaffected.

---

## Phase 4 — Cookie helpers + CSRF (double-submit)

**Files:** create `src/security/cookies.ts`, `src/security/csrf.ts`, `src/decorators/cookie.decorator.ts`, `src/decorators/csrf-exempt.decorator.ts`, `tests/cookies.test.ts`, `tests/csrf.test.ts`; modify `src/platform/elysia-adapter.ts` (Elysia ctor `cookie` config), `src/factory/techne-factory.ts`, `src/decorators/params.decorator.ts`, `src/core/router/router-execution-context.ts` (new `setGlobalMiddlewares()` sibling of `setGlobalGuards` ~348-352), `README.md`.

**API:**

```ts
TechneFactory.create({
  cookies: { secrets: env.COOKIE_SECRET, sign: ["session"] },           // → Elysia-native jar config
  csrf: { cookieName?, headerName? /* x-csrf-token */, methods? /* POST/PUT/PATCH/DELETE */, exclude?, cookie? },
});
@Cookie("session") session: string | undefined     // param decorator
setCookie(jar, "session", token)                   // defaults: httpOnly, sameSite=lax, secure in prod, path=/
@CsrfExempt()                                      // method/controller, @Public() metadata pattern
csrfProtection(opts)                               // importable for @Use() scoping
```

**Design:**

- Lean on Elysia's built-in reactive cookie jar (signing via ctor config — zero cost when `undefined`); framework adds the decorator, secure-defaults `setCookie` helper, and docs. No custom parser.
- CSRF as `beforeHandle` (needs cookie jar + per-route exemption metadata). Safe methods: mint 32 random hex bytes into cookie if absent (NOT HttpOnly — double-submit requires JS-readable; document). Unsafe methods: `crypto.timingSafeEqual` compare of header vs cookie (the `JwtService` primitive); mismatch → `set.status` + `mapException(ctx, new ForbiddenException("CSRF token mismatch"))`.
- Global wiring: `csrf` option compiles ONE middleware; `setGlobalMiddlewares` appends it for every route lacking `@CsrfExempt` (read via `Reflector.getAllAndOverride`, the `JwtAuthGuard` pattern). Cookie name `__Host-csrf` when secure, `csrf` over plain HTTP dev.
- Document: pure-Bearer APIs should exempt (CSRF only matters for cookie-auth'd browser clients); pairing with CORS `credentials: true`.
- **Verify early in PR:** Elysia 1.4.x cookie jar availability inside `beforeHandle`; fallback = parse `cookie` header directly in middleware.

**Tests:** cookie read/signed roundtrip/`setCookie` defaults + `__Host-` constraints; CSRF GET-mints / POST-without-header 403 problem+json / match 200 / mismatch 403 / exemptions / exclude paths / length-mismatch doesn't throw.

---

## Phase 5 — Internal inputs: queue/MQ payload validation + console arg validation

**Files:** modify `src/mq/define-queue.ts`, `src/mq/dispatcher.ts`, `src/mq/queue.ts`, `src/mq/registry.ts` (worker-handler wrap, two sites), `src/mq/errors.ts` (new `QueuePayloadValidationError`), `src/queue/define-queue.ts` + `src/queue/worker.ts` (legacy mirror, dispatch-time only), `src/console/types.ts`, `src/console/decorators/` (new `@Options(Dto)`), `src/console/argument-resolver.ts`, `README.md`. Create `tests/mq-payload-validation.test.ts`, `tests/console-options-validation.test.ts`.

**API:**

```ts
defineQueue({ name: "tasks", jobs: { "initiate-task": {} as InitiateTask },
              schemas: { "initiate-task": InitiateTaskDto } },   // @Dto class or raw TSchema
            { validate: "dispatch" | "consume" | "both" });      // default: off

@Command("deploy") run(@Options(DeployOptions) opts: DeployOptions) {}  // @IsString/@Min/etc on the class
```

**Design:**

- Validators compile once in `finalizeQueueDef` (DTO → existing `getOrCreateDtoValidator`; raw schema → `TypeCompiler.Compile`). Per-queue boot-time boolean — queues without schemas pay nothing.
- Dispatch failure throws synchronously at producer; consume failure throws `QueuePayloadValidationError` from worker wrapper → existing `@OnFailure`/`failed()` flow. Schemas describe the **wire shape** (post-JSON-roundtrip: Dates are strings — document). Enforce `schemas` keys ⊆ `jobs` keys with boot `TypeError`.
- Console: `@Options(Dto)` collects parsed `--flags` into one bag, coerces via design types, validates via existing `firstValidationError`, surfaces as `ConsoleArgumentError` (existing type). Existing positional/option decorators untouched.

**Tests:** valid/invalid dispatch with property-level errors; `validate: "consume"` enqueues bad payload but worker fails into `@OnFailure`; unset = back-compat passthrough; raw-TSchema; legacy queue path; console valid/invalid flags, coercion-before-validation, error format via `ConsoleTester`.

---

## Reused machinery (cross-phase)

| Existing utility | Where | Used by |
|---|---|---|
| `RouterResponseController.mapException` | `src/core/router/router-response-controller.ts` | P2 429, P3 upload 422, P4 403 |
| Compile-at-boot frozen records (`compileCorsOptions`) | `elysia-adapter.ts:585-637` | P1, P2 |
| `set.status + return body` middleware idiom | `routes-resolver.ts:82-98` (verified) | P2, P4 |
| `stripUnknownProperties` (same-ref fast path) | `src/schema/dto.ts:291-296` | P3 |
| `timingSafeEqual` idiom | `src/jwt/jwt.service.ts` | P4 |
| `@Public()` metadata + `Reflector.getAllAndOverride` | `src/jwt/jwt-auth.guard.ts:16-19` | P2 `@RateLimit`, P4 `@CsrfExempt` |
| `TooManyRequestsException` + `docs/errors/too-many-requests.md` | `src/exceptions/http-errors.ts` | P2 |
| `getOrCreateDtoSchema` / compiled validator registries | `src/schema/dto.ts` | P3, P5 |
| CORS LRU Map-reinsertion cache idiom | `elysia-adapter.ts:564-581` | P2 store |

## Verification (every phase)

1. `bun install --frozen-lockfile` (guards against the known elysia-link breakage), then `bun test` — full suite must stay green (80+ files; watch `tests/error-contract.test.ts`, `tests/elysia-adapter.test.ts`, `tests/dto-validation.test.ts`, `tests/perf-fixes-regressions.test.ts`).
2. New feature tests per phase as listed above; problem+json bodies asserted against the RFC 7807 contract.
3. Zero-cost contract: assert no extra hooks/headers/`beforeHandle` entries when the feature's option is absent.
4. P1 body-limit and any socket-level behavior need a real `listen` on an ephemeral port (`app.handle()` bypasses `Bun.serve`).
5. Manual smoke per phase: boot the dev app, `curl -i` to inspect headers (P1), hammer an endpoint past the limit (P2), send oversized/malformed inputs (P3), exercise the CSRF cookie/header dance (P4), dispatch an invalid job + run a CLI command with bad flags (P5).

Each phase ships as its own PR with a descriptive title/branch (no plan codes), README updates in the relevant section, and `docs/errors/` updates where status codes are involved.

## Progress

- [x] Plan approved
- [x] **Phase 1** — `feat/security-headers-and-server-limits` (security module, adapter/factory/listen wiring, 22 tests, README — PR pending review)
- [ ] Phase 2 — HTTP rate limiting
- [ ] Phase 3 — header DTOs, strip-unknown, upload validation
- [ ] Phase 4 — cookie helpers + CSRF
- [ ] Phase 5 — queue/MQ payload + console arg validation
