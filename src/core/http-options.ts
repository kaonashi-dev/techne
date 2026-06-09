export interface GlobalPrefixOptions {
  exclude?: string[];
}

export type VersioningType = "uri" | "header";

export interface VersioningOptions {
  type: VersioningType;
  header?: string;
  prefix?: string | false;
  defaultVersion?: string | string[];
  extractor?: (request: Request) => string | string[] | undefined;
}

export interface CorsOptions {
  origin?: string | string[] | boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface TechneValidationOptions {
  /**
   * When `true`, the validation error response includes every error reported
   * by the schema. When omitted/`false` (default), only the first error is
   * returned.
   */
  exhaustive?: boolean;
  /**
   * When `true`, unknown top-level properties are stripped from the request
   * body instead of rejected. Applies globally to all routes whose body DTO
   * uses a DTO class (whether via `@Body(Dto)` or typed `@Body()`).
   *
   * An explicit per-DTO `@Dto({ stripUnknown })` value overrides this flag in
   * both directions: `true` enables stripping without the global flag, and
   * `false` keeps a DTO strict even when the global flag is on.
   *
   * **Note:** v1 strip-unknown is top-level properties only.
   */
  stripUnknown?: boolean;
}

export interface RouteRegistrationOptions {
  globalPrefix?: {
    prefix: string;
    exclude?: string[];
  };
  versioning?: VersioningOptions;
}
