import type { ExecutionContext } from "../core/execution-context";

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}
