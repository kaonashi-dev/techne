# Build BOM (Bill of Materials)

Techne builds are reproducible against an explicit Bun version. Do not use
floating tags (`latest`, `1`) for release artifacts.

## Channels

| Channel | Bun | `@types/bun` | Use |
| --- | --- | --- | --- |
| Stable | `1.4.4` | `1.4.4` | Default binary, cross-compilation |
| AOT preview | `1.4.4-canary.20261109.1` (`bun --revision`: `1.4.4-canary.1+2596ac5d3`) | canary/1.5 types | `--aot`, `--trim`, `--explain` |
| Future | `1.5.x` | matching | Re-evaluate after release |

`bun --version` reports `1.4.4` for the canary build too. Record
`bun --revision` in the build manifest and CI logs. AOT commands must run with
that canary Bun on `PATH` (or with its explicit path); the `techne` shebang
resolves `bun` from `PATH`.

## Runtime and tooling

| Component | Pinned value |
| --- | --- |
| Bun (development/CI) | `.bun-version` = `1.4.4` |
| Package manager | `packageManager` = `bun@1.4.4` |
| TypeScript | `^7.0.2` |
| Docker builder (binary/bundle) | `oven/bun:1.4.4` |
| Docker builder (AOT preview) | `oven/bun:canary` (pin to a digest for release) |
| Docker runtime (binary/AOT) | `debian:bookworm-slim` |
| Docker runtime (bundle) | `oven/bun:1.4.4-slim` |

## Linux artifact matrix

| Artifact | Build command | Cross-compiles? |
| --- | --- | --- |
| Linux x64 binary | `techne build --compile --target=bun-linux-x64` | Yes |
| Linux arm64 binary | `techne build --compile --target=bun-linux-arm64` | Yes |
| Linux x64 AOT | `techne build --aot --trim` on Linux x64 | No |
| Linux arm64 AOT | `techne build --aot --trim` on Linux arm64 | No |
| Linux x64 bundle | `techne build --target=bun` | Yes |

## Release checklist

1. `bun install --frozen-lockfile` with the pinned Bun version.
2. `bun test` and `bun run typecheck`.
3. Build each Linux target, with `--manifest <artifact>.build.json`.
4. Smoke-test the artifact (health endpoint, one validated request, SIGTERM).
5. Publish the artifact, manifest, SHA256 checksum and (if applicable) SBOM.
6. For AOT preview, publish `--explain=json` output and keep the job
   non-blocking until Bun 1.5 is stable.
