import type { ExecutionContext } from "../core/execution-context";

export interface CallHandler<T = any> {
  handle(): Promise<T> | T;
}

export interface TechneInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R> | R;
}

/** @deprecated use TechneInterceptor */
export type BnestInterceptor<T = any, R = any> = TechneInterceptor<T, R>;
