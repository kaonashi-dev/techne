export type ConsoleParamKind = "argument" | "option";

export interface ConsoleCommandMeta {
  name: string;
  description?: string;
  aliases?: string[];
  hidden?: boolean;
  middleware?: any[];
}

export interface ConsoleParamMeta {
  index: number;
  kind: ConsoleParamKind;
  name: string;
  description?: string;
  aliases?: string[];
  required?: boolean;
  default?: unknown;
  enum?: Record<string, string | number>;
  metatype?: Function;
}

export interface CommandEntry {
  name: string;
  ctor: any;
  methodName: string;
  meta: ConsoleCommandMeta;
  params: ConsoleParamMeta[];
}
