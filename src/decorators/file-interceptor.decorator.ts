import "../reflect-setup";
import type { TechneInterceptor, CallHandler } from "../interfaces/interceptor.interface";

export function FileInterceptor(
  _fieldName: string,
  _options?: Record<string, unknown>,
): TechneInterceptor {
  return {
    intercept(_context: any, next: CallHandler) {
      return next.handle();
    },
  };
}
