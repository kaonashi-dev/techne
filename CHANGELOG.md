# Changelog

All notable changes to Techne are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `ResponseHook` and `@OnResponse()` for the Techne v1 flat HTTP response-hook
  metadata surface.

### Removed

- Public interceptor and pipe exports from `@kaonashi-dev/techne/common`,
  including `UseInterceptors`, `FileInterceptor`, `UsePipes`,
  `TechneInterceptor`, `PipeTransform`, `APP_INTERCEPTOR`, and `APP_PIPE`.
- CLI `g pipe` and `g interceptor` generator entries.
- The retired pre-Techne compatibility package shim, CLI alias, public API
  aliases, and old config filename fallback.

## [0.4.0] - 2026-05-13 — Renamed project to Techne

> **Breaking — read first.** The project has been renamed to `Techne` (Greek
> τέχνη — "applied craft"). The npm package is now `@kaonashi-dev/techne`
> and the CLI bin is `techne`. **See [MIGRATING.md](./MIGRATING.md) for the
> upgrade recipe.**
>
> Concrete breaking changes:
>
> 1. **Package name**: use `@kaonashi-dev/techne`.
> 2. **CLI bin**: use `techne <cmd>`.
> 3. **Redis prefixes**: defaults use `techne:queue`, `techne:mq`, and
>    `techne`.
> 4. **RFC 7807 problem `type` URL**: now uses
>    `https://github.com/kaonashi-dev/techne/blob/main/docs/errors/<slug>.md`.
> 5. **OpenAPI marker**: `x-techne-unknown-kind`
>    (diagnostic-only, no API contract).
>
> Compatibility aliases were retained through the 0.4 line and scheduled for
> removal in the next breaking release.

### Added

- `defineConfig({ schema, source?, coerce?, arraySeparator? })` validates env values against a TypeBox schema at startup and returns a typed `AppConfig` with `.get()` / `.getOrThrow()`; `ConfigValidationError` carries per-field failures.
- `defineTechneConfig(config)` typing helper for `techne.config.ts`, consumed by `TechneFactory.create()` / `bootstrap()` from `process.cwd()`.
- `bootstrap(module?, overrides?)` and `techne(module?, options?)` shorthands in `@kaonashi-dev/techne/core` for one-line `main.ts` entrypoints.
- `definePlugin({ name, version?, dependencies?, setup })` plugin protocol; `app.register(plugin, options)`, `app.use(elysiaPlugin)`, and `app.getRegisteredPlugins()` on `TechneApplication`.
- `PluginContext` exposes `provide`, `resolve`, `onReady`, `onShutdown`, `http()`, and a scoped `logger`.
- RFC 7807 error responses with `type`, `title`, `status`, `detail`, `code`, `instance`, `requestId`, and a `Content-Type: application/problem+json` header.
- `HttpException` accepts a structured `(response, status, options?)` signature plus a `{ code, type }` options object on every subclass.
- `REASON_PHRASES` exported from `@kaonashi-dev/techne/common` for the standard HTTP reason-phrase table.
- Auto-registered `GET /healthz` (liveness) and `GET /readyz` (readiness) endpoints, configurable via `TechneApplicationOptions.health` (`enabled`, `livenessPath`, `readinessPath`, `checks`).
- Graceful shutdown with `TechneApplicationOptions.shutdown` (`gracePeriod`, `signals`); HTTP 503 on new requests while in-flight work drains.
- `x-request-id` propagation: header echoed back on every response and surfaced as `requestId` in problem documents.
- `LoggerMode` (`pretty | json | false`) plus `Logger.setMode()` and `createRequestLogger(requestId, context?)` for structured per-request child loggers.
- `compileStringifier(schema)` fast TypeBox stringifier in `@kaonashi-dev/techne/schema`, cached per schema identity.
- Cost-tagged route slow path that hoists static `@Injectable()` guards/interceptors at route registration time.
- CLI commands `dev`, `start`, `test`, `doctor`, and `deploy`; new generators `g middleware|guard|pipe|filter|interceptor|dto|docker|client`.
- Multi-stage Bun `Dockerfile` + `.dockerignore` generator (`techne g docker` and `techne deploy --target docker`). Generated Dockerfile uses an unprivileged OS user named `techne`.
- Benchmark matrix under `benchmarks/` covering raw Elysia vs Techne, fast path, slow path, validation, response schema, DI, and cold start.
- Auto OpenAPI 3.1 emitter: `SwaggerModule.createAutoDocument(app, builder?)`, `emitOpenApiDocument(app, builder?)`, and `typeboxToOpenApi(schema)` in `@kaonashi-dev/techne/swagger`. Default `info.title` is now `"Techne API"`.
- `ConfigModule.forApp(config)` global module that publishes an `AppConfig` under the `APP_CONFIG` token, retrievable via `@InjectConfig()`.
- `docs/errors/{not-found,bad-request,unauthorized,forbidden,conflict,unprocessable-entity,too-many-requests,internal-server-error,bad-gateway,service-unavailable,gateway-timeout}.md` — stub doc pages backing the RFC 7807 `type` URLs.

### Changed

- Error responses are now served as `application/problem+json` (RFC 7807) instead of the legacy `{ statusCode, message, error }` JSON shape.
- Scaffolded projects (`techne new`) emit a `bootstrap()` `main.ts` paired with a `techne.config.ts` instead of a manual `TechneFactory.create()` block.
- Config-file discovery prefers `techne.config.{ts,js,mjs}`.
- Internal symbols, plugin names, and in-flight counter keys switched to the `techne:` namespace.

### Deprecated

- `app.setGlobalPrefix()`, `app.enableVersioning()`, `app.enableCors()`, and `app.useGlobalGuards()` — declare these in `techne.config.ts` instead. Setters emit a one-time deprecation warning per process and will be removed in v0.5+.
- Pre-Techne public aliases and config filenames stayed available through the
  0.4 line and were scheduled for removal in the next breaking release.

### Performance

- Arity-specialized compiled handlers on the fast path for routes without enhancers.
- Cost-tagged slow path that hoists static guards/interceptors at registration time so they cost nothing per request.
- Compiled, schema-keyed TypeBox stringifier used automatically for routes with a `response` schema.
- Cheaper validation error path: lazy `ValidationError[]` construction and reduced allocation in `ValidationPipe`.
- Lighter request-id and in-flight tracking on the hot path.
