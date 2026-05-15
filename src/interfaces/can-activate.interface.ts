import type { ResponseHookContext } from "./response-hook.interface";

export interface CanActivate {
  canActivate(context: ResponseHookContext): boolean | Promise<boolean>;
}
