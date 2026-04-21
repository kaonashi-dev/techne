import { createHmac, timingSafeEqual } from "node:crypto";
import { Inject } from "../decorators/inject.decorator";
import { Injectable } from "../decorators/injectable.decorator";
import { JWT_MODULE_OPTIONS } from "./tokens";

export interface JwtSignOptions {
  expiresIn?: number | string;
  issuer?: string;
  audience?: string;
  subject?: string;
}

export interface JwtVerifyOptions {
  issuer?: string;
  audience?: string;
}

export interface JwtModuleOptions {
  secret: string;
  signOptions?: JwtSignOptions;
  verifyOptions?: JwtVerifyOptions;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url<T = any>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
}

function parseExpiresIn(value: number | string | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (!value) return undefined;
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? undefined : numeric;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24,
  };
  return amount * multipliers[unit];
}

@Injectable()
export class JwtService {
  constructor(@Inject(JWT_MODULE_OPTIONS) private readonly options: JwtModuleOptions) {}

  async signAsync(payload: Record<string, any>, options: JwtSignOptions = {}): Promise<string> {
    const header = { alg: "HS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const mergedOptions = { ...this.options.signOptions, ...options };
    const expiresIn = parseExpiresIn(mergedOptions.expiresIn);
    const claims = {
      ...payload,
      iat: now,
      ...(expiresIn ? { exp: now + expiresIn } : {}),
      ...(mergedOptions.issuer ? { iss: mergedOptions.issuer } : {}),
      ...(mergedOptions.audience ? { aud: mergedOptions.audience } : {}),
      ...(mergedOptions.subject ? { sub: mergedOptions.subject } : {}),
    };

    const encodedHeader = encodeBase64Url(JSON.stringify(header));
    const encodedPayload = encodeBase64Url(JSON.stringify(claims));
    const signature = this.sign(`${encodedHeader}.${encodedPayload}`);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  async verifyAsync<T = Record<string, any>>(
    token: string,
    options: JwtVerifyOptions = {},
  ): Promise<T> {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new Error("Invalid JWT");
    }

    const expectedSignature = this.sign(`${encodedHeader}.${encodedPayload}`);
    const signatureBuffer = Buffer.from(encodedSignature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new Error("Invalid JWT signature");
    }

    const payload = decodeBase64Url<Record<string, any>>(encodedPayload);
    const now = Math.floor(Date.now() / 1000);
    const mergedOptions = { ...this.options.verifyOptions, ...options };

    if (payload.exp && now >= payload.exp) {
      throw new Error("JWT expired");
    }
    if (mergedOptions.issuer && payload.iss !== mergedOptions.issuer) {
      throw new Error("JWT issuer mismatch");
    }
    if (mergedOptions.audience && payload.aud !== mergedOptions.audience) {
      throw new Error("JWT audience mismatch");
    }

    return payload as T;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.options.secret).update(value).digest("base64url");
  }
}
