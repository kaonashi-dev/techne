import type { ExecutionContext } from "../core/execution-context";

export interface CallHandler<T = any> {
  handle(): Promise<T> | T;
}

export interface BnestInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R> | R;
}
