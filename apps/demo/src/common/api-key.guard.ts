import { Inject, Injectable } from "../../../../src/common/index.ts";
import type { CanActivate, ResponseHookContext } from "../../../../src/common/index.ts";
import { ForbiddenException } from "../../../../src/common/index.ts";
import { API_KEY } from "../tokens";

/**
 * A hand-written `CanActivate` guard demonstrating constructor DI inside a
 * guard. It checks the `x-api-key` header against the injected API key.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(API_KEY) private readonly apiKey: string) {}

  canActivate(context: ResponseHookContext): boolean {
    const provided = context.ctx?.headers?.["x-api-key"];
    if (provided !== this.apiKey) {
      throw new ForbiddenException("Invalid or missing x-api-key header", {
        code: "auth.invalid_api_key",
      });
    }
    return true;
  }
}
