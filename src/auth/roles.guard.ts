import { ROLES_METADATA } from "../common/constants";
import { Injectable } from "../decorators/injectable.decorator";
import type { CanActivate } from "../interfaces/can-activate.interface";
import { Reflector } from "../core/reflector";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: any): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userRoles = Array.isArray(request?.user?.roles) ? request.user.roles : [];
    return roles.some((role) => userRoles.includes(role));
  }
}
