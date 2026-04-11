import "../reflect-setup";

/**
 * NestJS-compatible Reflector. Thin wrapper over `Reflect.getMetadata` that
 * exposes ergonomic helpers for reading handler/class metadata from Guards,
 * Interceptors, and Filters.
 *
 * Usage:
 * ```ts
 * @Injectable()
 * class RolesGuard implements CanActivate {
 *   constructor(private reflector: Reflector) {}
 *   canActivate(ctx: ExecutionContext) {
 *     const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
 *       ctx.getHandler(),
 *       ctx.getClass(),
 *     ]);
 *   }
 * }
 * ```
 */
export class Reflector {
  /** Read metadata associated with `key` from `target`. */
  public get<TResult = any, TKey extends string | symbol = string | symbol>(
    key: TKey,
    target: Function | object,
  ): TResult {
    return Reflect.getMetadata(key, target) as TResult;
  }

  /** Read metadata from each target and return all of them as an array. */
  public getAll<TResult extends any[] = any[], TKey extends string | symbol = string | symbol>(
    key: TKey,
    targets: (Function | object)[],
  ): TResult {
    return (targets ?? []).map((target) => Reflect.getMetadata(key, target)) as TResult;
  }

  /**
   * Read metadata from all targets and merge the results:
   * - Arrays are concatenated (de-duplicated by strict equality).
   * - Objects are shallow-merged (last write wins).
   * - Scalars: first defined value wins.
   */
  public getAllAndMerge<
    TResult extends any[] | object = any[],
    TKey extends string | symbol = string | symbol,
  >(key: TKey, targets: (Function | object)[]): TResult {
    const values = this.getAll(key, targets).filter((value) => value !== undefined);
    if (values.length === 0) return undefined as unknown as TResult;

    if (Array.isArray(values[0])) {
      return values.reduce<any[]>((acc, value) => {
        if (!Array.isArray(value)) return acc;
        for (const item of value) {
          if (!acc.includes(item)) acc.push(item);
        }
        return acc;
      }, []) as TResult;
    }

    if (typeof values[0] === "object" && values[0] !== null) {
      return Object.assign({}, ...values) as TResult;
    }

    return values[0] as TResult;
  }

  /**
   * Read metadata from all targets and return the first defined value.
   * Useful when handler-level decorators should override controller-level
   * ones (the standard NestJS override order is `[handler, class]`).
   */
  public getAllAndOverride<TResult = any, TKey extends string | symbol = string | symbol>(
    key: TKey,
    targets: (Function | object)[],
  ): TResult {
    for (const target of targets ?? []) {
      const metadata = Reflect.getMetadata(key, target);
      if (metadata !== undefined) return metadata as TResult;
    }
    return undefined as unknown as TResult;
  }
}
