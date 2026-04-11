import type { ArgumentsHost } from "../core/execution-context";

export interface ExceptionFilter<T = any> {
  catch(exception: T, host: ArgumentsHost): any;
}
