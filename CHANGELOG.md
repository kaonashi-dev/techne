# Changelog

All notable changes to Bnest are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `defineConfig({ schema, source?, coerce?, arraySeparator? })` validates env values against a TypeBox schema at startup and returns a typed `AppConfig` with `.get()` / `.getOrThrow()`; `ConfigValidationError` carries per-field failures.
- `defineBnestConfig(config)` typing helper for `bnest.config.ts`, consumed by `BnestFactory.create()` / `bootstrap()` from `process.cwd()`.
- `bootstrap(module?, overrides?)` and `bnest(module?, options?)` shorthands in `@kaonashi-dev/bnest/core` for one-line `main.ts` entrypoints.
- `definePlugin({ name, version?, dependencies?, setup })` plugin protocol; `app.register(plugin, options)`, `app.use(elysiaPlugin)`, and `app.getRegisteredPlugins()` on `BnestApplication`.
- `PluginContext` exposes `provide`, `resolve`, `onReady`, `onShutdown`, `http()`, and a scoped `logger`.
- RFC 7807 error responses with `type`, `title`, `status`, `detail`, `code`, `instance`, `requestId`, and a `Content-Type: application/problem+json` header.
- `HttpException` accepts a NestJS-style `(response, status, options?)` signature plus a `{ code, type }` options object on every subclass.
- `REASON_PHRASES` exported from `@kaonashi-dev/bnest/common` for the standard HTTP reason-phrase table.
- Auto-registered `GET /healthz` (liveness) and `GET /readyz` (readiness) endpoints, configurable via `BnestApplicationOptions.health` (`enabled`, `livenessPath`, `readinessPath`, `checks`).
- Graceful shutdown with `BnestApplicationOptions.shutdown` (`gracePeriod`, `signals`); HTTP 503 on new requests while in-flight work drains.
- `x-request-id` propagation: header echoed back on every response and surfaced as `requestId` in problem documents.
- `LoggerMode` (`pretty | json | false`) plus `Logger.setMode()` and `createRequestLogger(requestId, context?)` for structured per-request child loggers.
- `compileStringifier(schema)` fast TypeBox stringifier in `@kaonashi-dev/bnest/schema`, cached per schema identity.
- Cost-tagged route slow path that hoists static `@Injectable()` guards/interceptors at route registration time.
- CLI commands `dev`, `start`, `test`, `doctor`, and `deploy`; new generators `g middleware|guard|pipe|filter|interceptor|dto|docker|client`.
- Multi-stage Bun `Dockerfile` + `.dockerignore` generator (`bnest g docker` and `bnest deploy --target docker`).
- Benchmark matrix under `benchmarks/` covering raw Elysia vs Bnest, fast path, slow path, validation, response schema, DI, and cold start.
- Auto OpenAPI 3.1 emitter: `SwaggerModule.createAutoDocument(app, builder?)`, `emitOpenApiDocument(app, builder?)`, and `typeboxToOpenApi(schema)` in `@kaonashi-dev/bnest/swagger`.
- `ConfigModule.forApp(config)` global module that publishes an `AppConfig` under the `APP_CONFIG` token, retrievable via `@InjectConfig()`.

### Changed

- Error responses are now served as `application/problem+json` (RFC 7807) instead of the legacy `{ statusCode, message, error }` JSON shape.
- Scaffolded projects (`bnest new`) emit a `bootstrap()` `main.ts` paired with a `bnest.config.ts` instead of a manual `BnestFactory.create()` block.

### Deprecated

- `app.setGlobalPrefix()`, `app.enableVersioning()`, `app.enableCors()`, and `app.useGlobalGuards()` — declare these in `bnest.config.ts` instead. Setters emit a one-time deprecation warning per process and will be removed in v1.0.

### Performance

- Arity-specialized compiled handlers on the fast path for routes without enhancers.
- Cost-tagged slow path that hoists static guards/interceptors at registration time so they cost nothing per request.
- Compiled, schema-keyed TypeBox stringifier used automatically for routes with a `response` schema.
- Cheaper validation error path: lazy `ValidationError[]` construction and reduced allocation in `ValidationPipe`.
- Lighter request-id and in-flight tracking on the hot path.
