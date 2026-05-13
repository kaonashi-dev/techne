import { Injectable } from "../decorators/injectable.decorator";

export type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

/** Output format for {@link Logger}. Default is environment-driven. */
export type LoggerMode = "pretty" | "json" | false;

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function defaultMode(): LoggerMode {
  const env = (typeof Bun !== "undefined" ? Bun.env?.NODE_ENV : process.env.NODE_ENV) ?? "";
  return env === "production" ? "json" : "pretty";
}

@Injectable()
export class Logger {
  private context?: string;
  private requestId?: string;
  private static enabled = true;
  private static mode: LoggerMode = defaultMode();

  constructor(context?: string, requestId?: string) {
    this.context = context;
    this.requestId = requestId;
  }

  static setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Switch output mode globally. Pass `false` to silence the logger. */
  static setMode(mode: LoggerMode) {
    this.mode = mode;
  }

  /** Current global output mode. */
  static getMode(): LoggerMode {
    return this.mode;
  }

  setContext(context: string) {
    this.context = context;
  }

  /**
   * Returns a child logger that propagates `requestId` into every emitted
   * record (pretty mode prepends `[req=<id>]`, JSON mode adds a `requestId`
   * field). The parent's `context` is inherited but may be overridden.
   */
  child(requestId: string, context?: string): Logger {
    return new Logger(context ?? this.context, requestId);
  }

  private resolveContext(context?: string): string {
    return context || this.context || "Application";
  }

  private isJson(): boolean {
    return Logger.mode === "json";
  }

  private prettyMessage(level: LogLevel, message: any, context?: string): string {
    const timestamp = new Date().toLocaleString();
    const ctx = this.resolveContext(context);
    const pid = process.pid;

    let levelColor = colors.green;
    let levelStr = "LOG";

    switch (level) {
      case "error":
        levelColor = colors.red;
        levelStr = "ERR";
        break;
      case "warn":
        levelColor = colors.yellow;
        levelStr = "WRN";
        break;
      case "debug":
        levelColor = colors.cyan;
        levelStr = "DBG";
        break;
      case "verbose":
        levelColor = colors.gray;
        levelStr = "VRB";
        break;
    }

    const coloredContext = `${colors.yellow}[${ctx}]${colors.reset}`;
    const coloredLevel = `${levelColor}${levelStr}${colors.reset}`;
    const reqTag = this.requestId
      ? ` ${colors.gray}[req=${this.requestId}]${colors.reset}`
      : "";
    const prefix = `${colors.green}[Techne] ${pid}  -${colors.reset} ${timestamp}     ${coloredLevel} ${coloredContext}${reqTag}`;

    if (typeof message === "object") {
      return `${prefix}\n${JSON.stringify(message, null, 2)}`;
    }
    return `${prefix} ${levelColor}${message}${colors.reset}`;
  }

  private jsonRecord(level: LogLevel, message: any, context?: string): string {
    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      name: "Techne",
      msg: typeof message === "string" ? message : safeToMessage(message),
      ctx: this.resolveContext(context),
    };
    if (this.requestId) record.requestId = this.requestId;
    return JSON.stringify(record);
  }

  private emit(
    level: LogLevel,
    sink: (line: string) => void,
    message: any,
    context?: string,
  ) {
    if (!Logger.enabled || Logger.mode === false) return;
    sink(this.isJson() ? this.jsonRecord(level, message, context) : this.prettyMessage(level, message, context));
  }

  log(message: any, context?: string) {
    this.emit("log", console.log, message, context);
  }

  error(message: any, trace?: string, context?: string) {
    if (!Logger.enabled || Logger.mode === false) return;
    const sink = console.error.bind(console);
    sink(this.isJson() ? this.jsonRecord("error", message, context) : this.prettyMessage("error", message, context));
    if (trace) {
      sink(trace);
    }
  }

  warn(message: any, context?: string) {
    this.emit("warn", console.warn, message, context);
  }

  debug(message: any, context?: string) {
    this.emit("debug", console.debug, message, context);
  }

  verbose(message: any, context?: string) {
    this.emit("verbose", console.log, message, context);
  }
}

/**
 * Creates a {@link Logger} bound to a request id so every line it emits
 * carries the id. Used by the HTTP adapter to scope per-request logs.
 */
export function createRequestLogger(requestId: string, context?: string): Logger {
  return new Logger(context, requestId);
}

function safeToMessage(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
