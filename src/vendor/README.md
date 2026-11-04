# Vendored sources

Techne has no runtime dependencies. These libraries are kept here as TypeScript source
(each directory keeps its upstream MIT `LICENSE`) and are imported by relative path.

| Directory       | Upstream                                                                 | Revision                    |
| --------------- | ------------------------------------------------------------------------ | --------------------------- |
| `elysia`        | [elysiajs/elysia](https://github.com/elysiajs/elysia) `src/`             | `2e88cf07` (2.0.0-beta.1)   |
| `typebox`       | [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox) `src/`   | tag `1.3.10`                |
| `exact-mirror`  | [elysiajs/exact-mirror](https://github.com/elysiajs/exact-mirror) `src/` | tag `1.2.2`                 |
| `memoirist`     | [SaltyAom/memoirist](https://github.com/SaltyAom/memoirist) `src/`       | `b2d7bc2` (1.2.1)           |
| `deuri`         | [re-utils/deuri](https://github.com/re-utils/deuri) `src/`               | `8e81ad2^` (3.0.0)          |
| `openapi-types` | [kogosoftwarellc/open-api](https://github.com/kogosoftwarellc/open-api) `packages/openapi-types/` | 12.1.3 |

## Local changes

- Bare package specifiers (`typebox`, `typebox/*`, `exact-mirror`, `memoirist`, `deuri`,
  `openapi-types`) are rewritten to relative paths, and `.ts` extensions are dropped from
  relative imports.
- Elysia's `plugin/aot` bundler integrations (Vite, esbuild, rspack, unplugin) are not vendored.
- Class fields without an initializer are marked `declare`, so they keep upstream's
  `useDefineForClassFields: false` behaviour under any consumer tsconfig.
- Elysia: `compile/aot.ts` reads its version from `version.ts` instead of `package.json`;
  the TypeBox `TSchemaOptions` augmentation targets the vendored module;
  `WeakMap.prototype.getOrInsertComputed` is replaced with `get`/`set`; the `duplex`
  request init is cast to `RequestInit`; `type/validator/exact-mirror.ts` imports the
  vendored exact-mirror statically instead of an optional runtime `require('exact-mirror')`
  (without it Elysia silently falls back to the slower TypeBox `Clean`).

Formatting and lint are not applied to this directory so it stays diffable against upstream.
