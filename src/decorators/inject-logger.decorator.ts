import "../reflect-setup";
import { INJECT_METADATA } from "../common/constants";
import { Logger } from "../services/logger.service";

/**
 * Per-context token registry. Populated at class-definition time when
 * `@InjectLogger` runs; consumed by `TechneFactory.create()` to auto-register
 * the matching factory providers before the container resolves classes.
 */
export const loggerTokens = new Map<string, symbol>();

/**
 * Get (or lazily create) the DI token for a given logger context. The token is
 * a `Symbol.for(...)` so the same symbol is returned across module boundaries.
 */
export function loggerTokenFor(context: string): symbol {
  let token = loggerTokens.get(context);
  if (!token) {
    token = Symbol.for(`techne:logger:${context}`);
    loggerTokens.set(context, token);
  }
  return token;
}

/**
 * Inject a {@link Logger} pre-scoped to the given context string.
 *
 * ```ts
 * @Injectable()
 * export class UserService {
 *   constructor(@InjectLogger("UserService") private readonly logger: Logger) {}
 * }
 * ```
 *
 * `TechneFactory.create()` automatically registers the backing factory
 * provider for every context used via this decorator.
 */
export function InjectLogger(context: string): ParameterDecorator {
  const token = loggerTokenFor(context);
  return (target: object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existing = (Reflect.getMetadata(INJECT_METADATA, target) as Record<number, any>) ?? {};
    existing[parameterIndex] = token;
    Reflect.defineMetadata(INJECT_METADATA, existing, target);
  };
}

/**
 * Convenience re-export so callers only need to import from the decorator
 * rather than knowing the token symbol directly.
 */
export { Logger };
