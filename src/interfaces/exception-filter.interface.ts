export interface ExceptionFilter {
  catch(exception: unknown, context: any): any;
}
