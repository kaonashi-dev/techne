import type { ExecutionContext } from "../core/execution-context";

export interface CallHandler<T = any> {
  handle(): Promise<T> | T;
}

export interface BnestInterceptor<T = any, R = any> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R> | R;
}

/** Canonical name. `BnestInterceptor` is kept as a deprecated alias through v0.4.x. */
export type TechneInterceptor<T = any, R = any> = BnestInterceptor<T, R>;
