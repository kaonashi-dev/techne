import "../reflect-setup";
import type { BnestInterceptor, CallHandler } from "../interfaces/interceptor.interface";

export function FileInterceptor(
  _fieldName: string,
  _options?: Record<string, unknown>,
): BnestInterceptor {
  return {
    intercept(_context: any, next: CallHandler) {
      return next.handle();
    },
  };
}
