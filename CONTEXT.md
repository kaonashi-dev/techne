# Techne Context

## Decorator Metadata

- Decorator metadata is framework metadata stored through the local `Reflect` metadata store patched by `src/reflect-setup.ts`.
- Append-array metadata is the composition rule for decorators whose values stack in declaration order.
- `AppendArrayMetadata` is the seam for append-array metadata. Public adapters include `UseGuards`, `UsePipes`, `UseFilters`, and `UseInterceptors`.
- `SetMetadata` remains the overwrite rule for metadata values that do not stack.
