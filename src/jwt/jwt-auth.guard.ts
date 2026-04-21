import { PUBLIC_METADATA } from "../common/constants";
import { Injectable } from "../decorators/injectable.decorator";
import type { CanActivate } from "../interfaces/can-activate.interface";
import { Reflector } from "../core/reflector";
import { UnauthorizedException } from "../exceptions";
import { JwtService } from "./jwt.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: any): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const header =
      request?.headers?.authorization ?? request?.request?.headers?.get?.("authorization");
    if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const token = header.slice("Bearer ".length);
    const payload = await this.jwtService.verifyAsync(token);
    request.user = payload;
    if (request.request && typeof request.request === "object") {
      (request.request as Record<string, unknown>).user = payload;
    }
    return true;
  }
}
