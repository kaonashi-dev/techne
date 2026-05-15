import type { ResponseHookContext } from "./response-hook.interface";

export interface ExceptionFilter<T = any> {
  catch(exception: T, host: ResponseHookContext): any;
}
