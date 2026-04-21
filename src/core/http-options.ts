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

export interface RouteRegistrationOptions {
  globalPrefix?: {
    prefix: string;
    exclude?: string[];
  };
  versioning?: VersioningOptions;
}
