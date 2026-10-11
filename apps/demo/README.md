# Techne Demo

This is the **legacy decorator-runtime** reference. New applications should
start with [`apps/native`](../native) and the [native architecture](../../ARCHITECTURE.md).

A single reference application that exercises **every zero-infra feature** of the
Techne framework, plus an [`oha`](https://github.com/hatoo/oha)-based performance
harness that averages real-HTTP metrics into one file for cross-iteration
comparison.

> "Zero-infra" = everything that runs without external services. The MQ uses the
> in-memory driver; there is no database, Redis, or OpenTelemetry collector.

## Running

This app lives inside the Techne repo and imports the framework directly from
`../../src` by relative path, so **all scripts run from the repository root**
(the package scripts `cd ../..` for you). No separate `bun install` is needed —
the repo's root install covers it.

```bash
# from the repo root
bun run apps/demo/src/main.ts          # start the server (PORT=3000 by default)
bun test apps/demo/tests/              # run the e2e + unit tests
bun run apps/demo/perf/run-perf.ts     # run the oha perf harness (needs `oha`)
```

On boot you'll see:

```
🚀 Techne demo listening on http://localhost:3000
   OpenAPI:  http://localhost:3000/api-docs
   Metrics:  http://localhost:3000/metrics
   Health:   http://localhost:3000/healthz
```

### Route prefix

The app enables a global prefix (`api`) **and** URI versioning (`v1`), which
Techne composes as `/{version}/{prefix}/...`. So application routes live under
**`/v1/api/...`**. Framework/plugin routes are not prefixed: `/healthz`,
`/readyz`, `/metrics`, `/api-docs`.

## Feature map

| Feature | Where |
| --- | --- |
| `defineTechneConfig`, all runtime options | `techne.config.ts` |
| `TechneFactory.create`, OpenAPI setup, `app.listen` | `src/main.ts` |
| `defineFeature` modules | `src/*/*.module.ts` |
| Controllers, all HTTP verbs, `@Param/@Query/@Body/@Headers` | `src/users/users.controller.ts` |
| DTO validation + `stripUnknown` | `src/users/dto/*.ts` |
| `@Injectable`, `@Inject(token)`, `@InjectLogger` | `src/users/users.service.ts` |
| `useValue` + `useFactory` providers | `src/app.module.ts`, `src/tokens.ts` |
| `@Version` (URI versioning) | `src/users/users.controller.ts` + config |
| `@Middleware`, `@OnResponse` hook | `src/common/{logging.middleware,cache.hook}.ts` |
| Custom `CanActivate` guard (`@UseGuards`) | `src/common/api-key.guard.ts` |
| Scoped `ExceptionFilter` (`@Catch` + `@UseFilters`) | `src/common/http-exception.filter.ts` |
| Custom param decorators (`createParamDecorator`) | `src/common/{current-user,context}.decorator.ts` |
| Typed config (`defineConfig`/`appConfig`/`@InjectConfig`) | `src/config/app.config.ts`, `src/misc/status.controller.ts` |
| JWT (`jwt`, `JwtService`, `JwtAuthGuard`), `@Public`, `@Roles`, `RolesGuard` | `src/auth/*` |
| Security: `securityHeaders`, `rateLimit` + `@RateLimit`, `cookies` + `setCookie`, `csrf` + `@CsrfExempt`, `resolveClientIp` | `techne.config.ts`, `src/auth/auth.controller.ts`, `src/misc/cookies.controller.ts` |
| Plugin protocol (`definePlugin`) → `/metrics` | `src/plugins/metrics.plugin.ts` |
| CQRS (`Command`/`Query`/`Event` buses + handlers) | `src/cqrs/*` |
| MQ memory driver (`defineQueue`, `mq`, `@MqProcessor`, `@MqProcess`, `@InjectMq`) | `src/mq/*` |
| Single-action controller | `src/misc/report.controller.ts` |
| File upload validation (`@UploadedFile`) | `src/misc/files.controller.ts` |
| Health (`HealthCheckService`) + auto `/healthz` `/readyz` + graceful shutdown | `src/misc/health.controller.ts`, `techne.config.ts` |
| RFC 7807 exceptions | thrown across `src/users/users.service.ts` |
| Swagger auto-document | `src/main.ts` |
| Testing utilities (`Test`, `BufferSink`, `NullSink`) | `tests/app.e2e.test.ts` |

## Try it

```bash
B=http://localhost:3000/v1/api

curl $B/users                                            # list (fast path)
curl $B/users/1                                          # by id
curl -X POST $B/users -H 'content-type: application/json' \
  -d '{"name":"Grace","email":"grace@x.com","role":"editor"}'

# JWT: log in (email starting with "admin" gets the admin role), then call the guarded route
TOKEN=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@x.com","password":"secret"}' | bun -e 'console.log((await Bun.stdin.json()).accessToken)')
curl -H "authorization: Bearer $TOKEN" $B/admin/dashboard

# CQRS, MQ, api-key guard, exception filter
curl -X POST $B/cqrs/users -H 'content-type: application/json' -d '{"name":"Eve","email":"eve@x.com"}'
curl $B/cqrs/users
curl -X POST $B/mq/emails -H 'content-type: application/json' -d '{"to":"a@b.com","subject":"hi"}'
curl -H 'x-api-key: demo-api-key-1234567890' $B/status
curl -H 'x-api-key: demo-api-key-1234567890' $B/status/boom   # → 422 via the scoped filter

curl http://localhost:3000/metrics
curl http://localhost:3000/api-docs
```

## Implementation notes

- **Relative framework imports / run-from-root.** Because this app sits inside
  the framework repo with no published package or workspace install, it imports
  Techne from `../../src/<area>` and every script runs from the repo root so the
  framework's own dependencies (Elysia, TypeBox) resolve. A standalone consumer
  would instead `bun add github:kaonashi-dev/techne` and import
  `@kaonashi-dev/techne/<area>`.
- **CQRS buses via `ModuleRef`.** The framework registers the command/query/event
  buses *after* static providers and controllers are constructed, so
  `src/cqrs/cqrs.controller.ts` and `src/cqrs/create-user.handler.ts` resolve the
  buses lazily through `ModuleRef` to be sure they get the instances that have
  handlers bound.
- **CSRF.** Global double-submit CSRF is enabled. JSON/Bearer API controllers opt
  out with `@CsrfExempt()`; `src/misc/cookies.controller.ts` stays protected to
  demonstrate the 403 on a tokenless unsafe request.

## Performance

See [`perf/README.md`](./perf/README.md).
