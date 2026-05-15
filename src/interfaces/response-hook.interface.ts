export interface ResponseHookContext {
  readonly ctx: any;
  readonly controller: Function;
  readonly handler: Function;
}

export interface ResponseHook {
  transform(result: unknown, ctx: ResponseHookContext): unknown | Promise<unknown>;
}
