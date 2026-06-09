export type ConsoleParamKind = "argument" | "option" | "options-bag";

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
  /**
   * For `kind === "options-bag"`: the DTO class used to collect and validate
   * all `--flag` pairs into a single typed object.
   */
  dtoClass?: new (...args: any[]) => any;
}

export interface CommandEntry {
  name: string;
  ctor: any;
  methodName: string;
  meta: ConsoleCommandMeta;
  params: ConsoleParamMeta[];
}
