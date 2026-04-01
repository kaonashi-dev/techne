import { Injectable } from "../decorators/injectable.decorator";

export type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

@Injectable()
export class Logger {
  private context?: string;
  private static enabled = true;

  constructor(context?: string) {
    this.context = context;
  }

  static setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setContext(context: string) {
    this.context = context;
  }

  private formatMessage(level: LogLevel, message: any, context?: string) {
    const timestamp = new Date().toLocaleString();
    const ctx = context || this.context || "Application";
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
    const prefix = `${colors.green}[Bnest] ${pid}  -${colors.reset} ${timestamp}     ${coloredLevel} ${coloredContext}`;

    if (typeof message === "object") {
      return `${prefix}\n${JSON.stringify(message, null, 2)}`;
    }

    return `${prefix} ${levelColor}${message}${colors.reset}`;
  }

  log(message: any, context?: string) {
    if (!Logger.enabled) return;
    console.log(this.formatMessage("log", message, context));
  }

  error(message: any, trace?: string, context?: string) {
    if (!Logger.enabled) return;
    console.error(this.formatMessage("error", message, context));
    if (trace) {
      console.error(trace);
    }
  }

  warn(message: any, context?: string) {
    if (!Logger.enabled) return;
    console.warn(this.formatMessage("warn", message, context));
  }

  debug(message: any, context?: string) {
    if (!Logger.enabled) return;
    console.debug(this.formatMessage("debug", message, context));
  }

  verbose(message: any, context?: string) {
    if (!Logger.enabled) return;
    console.log(this.formatMessage("verbose", message, context));
  }
}
