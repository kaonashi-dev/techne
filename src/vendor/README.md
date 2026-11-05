# Vendored sources

Techne has no runtime dependencies. The HTTP core is Techne's own code (`src/server/`);
only TypeBox, used for schemas, is kept here as TypeScript source (with its upstream MIT
`LICENSE`) and imported by relative path.

| Directory | Upstream                                                               | Revision     |
| --------- | ---------------------------------------------------------------------- | ------------ |
| `typebox` | [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox) `src/` | tag `1.3.10` |

## Local changes

- Bare `typebox/*` specifiers are rewritten to relative paths, and `.ts` extensions are
  dropped from relative imports.
- TypeBox `Code()` (`typebox/compile/code.ts`) emits a module the consumer writes into
  their own project, so the imports in that generated source point at the
  `@kaonashi-dev/techne/typebox/*` subpaths rather than at relative paths.
- Class fields without an initializer are marked `declare`, so they keep upstream's
  `useDefineForClassFields: false` behaviour under any consumer tsconfig.

Formatting and lint are not applied to this directory so it stays diffable against upstream.
