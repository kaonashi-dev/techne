export interface CanActivate {
  canActivate(context: any): boolean | Promise<boolean>;
}
