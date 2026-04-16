export enum Scope {
  DEFAULT = "DEFAULT",
  REQUEST = "REQUEST",
  TRANSIENT = "TRANSIENT",
}

export interface ScopeOptions {
  scope?: Scope;
}
