export interface CallHandler {
  handle(): Promise<any>;
}

export interface BnestInterceptor {
  intercept(context: any, next: CallHandler): Promise<any>;
}
