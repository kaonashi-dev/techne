import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "../decorators/injectable.decorator";

export type LogLevel = "log" | "error" | "warn" | "debug" | "verbose";

/** Output format for {@link Logger}. Default is environment-driven. */
export type LoggerMode = "pretty" | "json" | false;

/** Priority order: lower number = higher priority (error=0 is most important). */
export const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  log: 2,
  debug: 3,
  verbose: 4,
};

/** Pluggable output sink. Swap in a {@link BufferSink} for test assertions. */
export interface LogSink {
  write(level: LogLevel, line: string): void;
}

/** Default sink — routes to the appropriate console method per level. */
class ConsoleSink implements LogSink {
  write(level: LogLevel, line: string) {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

/** Discards all output. Install via {@link Logger.setSink} to silence logs in tests. */
export class NullSink implements LogSink {
  write(_level: LogLevel, _line: string) {}
}

/** Collects log lines for test assertions. Install via {@link Logger.setSink}. */
export class BufferSink implements LogSink {
  readonly lines: string[] = [];
  readonly records: Array<{ level: LogLevel; line: string }> = [];
  write(level: LogLevel, line: string) {
    this.lines.push(line);
    this.records.push({ level, line });
  }
  clear() {
    this.lines.length = 0;
    this.records.length = 0;
  }
}

// Structured per-request context propagated via AsyncLocalStorage (L5).
export interface RequestContext {
  requestId?: string;
  traceId?: string;
  spanId?: string;
}

/** ALS store for per-request context. Set by the HTTP adapter's onRequest hook. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

// Cached at module load — avoids repeated property reads on every log line (L10).
const PID = process.pid;
// Gate ANSI codes on TTY; file/pipe sinks stay clean (L10).
const IS_TTY = process.stdout.isTTY === true;

const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const c = IS_TTY ? ANSI : { reset: "", green: "", yellow: "", red: "", cyan: "", gray: "" };

function defaultMode(): LoggerMode {
  const env = (typeof Bun !== "undefined" ? Bun.env?.NODE_ENV : process.env.NODE_ENV) ?? "";
  return env === "production" ? "json" : "pretty";
}

function defaultMinLevel(): LogLevel {
  const raw =
    (typeof Bun !== "undefined" ? Bun.env?.LOG_LEVEL : process.env.LOG_LEVEL) ?? "verbose";
  const level = raw.toLowerCase() as LogLevel;
  return LEVEL_ORDER[level] !== undefined ? level : "verbose";
}

/** Hand-rolled HH:mm:ss.SSS — avoids locale lookup of toLocaleString (L10). */
function formatTime(): string {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, "0");
  const m = now.getMinutes().toString().padStart(2, "0");
  const s = now.getSeconds().toString().padStart(2, "0");
  const ms = now.getMilliseconds().toString().padStart(3, "0");
  return `${h}:${m}:${s}.${ms}`;
}

/** JSON serializer with circular-reference protection and max-depth guard (L2). */
export function stringifySafe(value: unknown, indent?: number): string {
  const seen = new Set<unknown>();
  return JSON.stringify(
    value,
    (_key, val) => {
      if (val !== null && typeof val === "object") {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    },
    indent,
  );
}

/**
 * Masks the given dotted-path fields in a shallow copy of `obj`.
 * Operates on a single-level clone — does not deep-clone nested objects
 * (redacted paths beyond depth 2 are not supported in this version).
 */
function applyRedaction(obj: Record<string, unknown>, paths: string[]): Record<string, unknown> {
  if (paths.length === 0) return obj;
  const clone: Record<string, unknown> = { ...obj };
  for (const path of paths) {
    const parts = path.split(".");
    let target: any = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target == null || typeof target !== "object") {
        target = null;
        break;
      }
      target = target[parts[i]];
    }
    if (target != null && typeof target === "object") {
      target[parts[parts.length - 1]] = "[REDACTED]";
    }
  }
  return clone;
}

/** Arbitrary structured fields to merge into a log record (L4). */
export interface LogMeta {
  [key: string]: unknown;
}

/** Metadata for error records (L4). `trace` and `context` are promoted to top-level fields. */
export interface ErrorMeta extends LogMeta {
  trace?: string;
  context?: string;
}

@Injectable()
export class Logger {
  private context?: string;
  private requestId?: string;

  // Singleton static state (L3, L6, L7). Tests swap _sink; production code may
  // set _mode/minLevel via Logger.setMode/setMinLevel.
  // _mode is the single source of truth for "enabled" — `false` means disabled.
  // _preDisableMode tracks the mode in effect before setEnabled(false) so that
  // setEnabled(true) can restore it without guessing the environment default.
  private static _mode: LoggerMode = defaultMode();
  private static _preDisableMode: LoggerMode = defaultMode();
  private static _minLevel: LogLevel = defaultMinLevel();
  private static _sink: LogSink = new ConsoleSink();
  private static _redact: string[] = [];

  constructor(context?: string, requestId?: string) {
    this.context = context;
    this.requestId = requestId;
  }

  // ── Static configuration API ─────────────────────────────────────────────

  /**
   * Enable or disable all log output. `setEnabled(false)` is equivalent to
   * `setMode(false)`. `setEnabled(true)` restores the mode that was in effect
   * before the last disable call. Prefer `setMode()` for explicit control;
   * `setEnabled` is kept for backward compatibility with call sites that don't
   * know the desired mode.
   */
  static setEnabled(enabled: boolean) {
    if (enabled) {
      if (this._mode === false) {
        this._mode = this._preDisableMode !== false ? this._preDisableMode : defaultMode();
      }
    } else {
      if (this._mode !== false) this._preDisableMode = this._mode;
      this._mode = false;
    }
  }

  static setMode(mode: LoggerMode) {
    this._mode = mode;
    if (mode !== false) this._preDisableMode = mode;
  }

  static getMode(): LoggerMode {
    return this._mode;
  }

  static setMinLevel(level: LogLevel) {
    this._minLevel = level;
  }

  static getMinLevel(): LogLevel {
    return this._minLevel;
  }

  static setSink(sink: LogSink) {
    this._sink = sink;
  }

  static getSink(): LogSink {
    return this._sink;
  }

  static setRedact(paths: string[]) {
    this._redact = paths;
  }

  // ── Instance API ─────────────────────────────────────────────────────────

  setContext(context: string) {
    this.context = context;
  }

  child(requestId: string, context?: string): Logger {
    return new Logger(context ?? this.context, requestId);
  }

  private resolveContext(context?: string): string {
    return context || this.context || "Application";
  }

  /** Reads own requestId first; falls back to the ALS request context (L5). */
  private resolveRequestId(): string | undefined {
    if (this.requestId) return this.requestId;
    return requestContext.getStore()?.requestId;
  }

  private isEnabled(): boolean {
    return Logger._mode !== false;
  }

  private isAboveMinLevel(level: LogLevel): boolean {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[Logger._minLevel];
  }

  private prettyMessage(level: LogLevel, message: any, context?: string, meta?: LogMeta): string {
    const timestamp = formatTime();
    const ctx = this.resolveContext(context);
    const requestId = this.resolveRequestId();

    let levelColor = c.green;
    let levelStr = "LOG";
    switch (level) {
      case "error":
        levelColor = c.red;
        levelStr = "ERR";
        break;
      case "warn":
        levelColor = c.yellow;
        levelStr = "WRN";
        break;
      case "debug":
        levelColor = c.cyan;
        levelStr = "DBG";
        break;
      case "verbose":
        levelColor = c.gray;
        levelStr = "VRB";
        break;
    }

    const coloredContext = `${c.yellow}[${ctx}]${c.reset}`;
    const coloredLevel = `${levelColor}${levelStr}${c.reset}`;
    const reqTag = requestId ? ` ${c.gray}[req=${requestId}]${c.reset}` : "";
    const traceId = requestContext.getStore()?.traceId;
    const traceTag = traceId ? ` ${c.gray}[trace=${traceId}]${c.reset}` : "";
    const prefix = `${c.green}[Techne] ${PID}  -${c.reset} ${timestamp}     ${coloredLevel} ${coloredContext}${reqTag}${traceTag}`;

    let body: string;
    if (typeof message === "object" && message !== null) {
      body = `\n${stringifySafe(message, 2)}`;
    } else {
      body = ` ${levelColor}${message}${c.reset}`;
    }

    if (meta && Object.keys(meta).length > 0) {
      const metaStr = Object.entries(meta)
        .filter(([k]) => k !== "context")
        .map(([k, v]) => `${k}=${typeof v === "object" ? stringifySafe(v) : v}`)
        .join(" ");
      return metaStr ? `${prefix}${body} ${c.gray}${metaStr}${c.reset}` : `${prefix}${body}`;
    }
    return `${prefix}${body}`;
  }

  private jsonRecord(level: LogLevel, message: any, context?: string, meta?: LogMeta): string {
    const requestId = this.resolveRequestId();
    const als = requestContext.getStore();

    const record: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      name: "Techne",
      msg: typeof message === "string" ? message : stringifySafe(message),
      ctx: this.resolveContext(context),
      ...meta,
    };
    if (requestId) record.requestId = requestId;
    if (als?.traceId) record.traceId = als.traceId;
    if (als?.spanId) record.spanId = als.spanId;

    const toSerialize = Logger._redact.length > 0 ? applyRedaction(record, Logger._redact) : record;
    return stringifySafe(toSerialize);
  }

  private emit(level: LogLevel, message: any, context?: string, meta?: LogMeta) {
    if (!this.isEnabled()) return;
    if (!this.isAboveMinLevel(level)) return;
    const line =
      Logger._mode === "json"
        ? this.jsonRecord(level, message, context, meta)
        : this.prettyMessage(level, message, context, meta);
    Logger._sink.write(level, line);
  }

  log(message: any, contextOrMeta?: string | LogMeta, meta?: LogMeta) {
    if (typeof contextOrMeta === "string") {
      this.emit("log", message, contextOrMeta, meta);
    } else {
      this.emit("log", message, undefined, contextOrMeta);
    }
  }

  /**
   * Log an error. Supports two call signatures:
   *   - Legacy:  `error(message, trace?, context?)` — backward compatible
   *   - Structured: `error(err: Error, meta?)` — stack lands in the record, not a second line
   */
  error(message: any, traceOrMeta?: string | ErrorMeta, context?: string) {
    if (!this.isEnabled()) return;
    if (!this.isAboveMinLevel("error")) return;

    if (
      message instanceof Error &&
      (traceOrMeta === undefined || typeof traceOrMeta === "object")
    ) {
      // Structured: error(err: Error, meta?)
      const meta = traceOrMeta as ErrorMeta | undefined;
      const mergedMeta: ErrorMeta = { trace: message.stack, ...meta };
      this.emit("error", message.message, meta?.context ?? this.context, mergedMeta);
    } else {
      // Legacy: error(message, trace?, context?)
      const trace = typeof traceOrMeta === "string" ? traceOrMeta : undefined;
      const meta: ErrorMeta | undefined = trace ? { trace } : undefined;
      this.emit("error", message, context, meta);
      // Print trace as a separate line in pretty mode (legacy behavior)
      if (trace && Logger._mode !== "json") {
        Logger._sink.write("error", trace);
      }
    }
  }

  warn(message: any, contextOrMeta?: string | LogMeta, meta?: LogMeta) {
    if (typeof contextOrMeta === "string") {
      this.emit("warn", message, contextOrMeta, meta);
    } else {
      this.emit("warn", message, undefined, contextOrMeta);
    }
  }

  debug(message: any, contextOrMeta?: string | LogMeta, meta?: LogMeta) {
    if (typeof contextOrMeta === "string") {
      this.emit("debug", message, contextOrMeta, meta);
    } else {
      this.emit("debug", message, undefined, contextOrMeta);
    }
  }

  verbose(message: any, contextOrMeta?: string | LogMeta, meta?: LogMeta) {
    if (typeof contextOrMeta === "string") {
      this.emit("verbose", message, contextOrMeta, meta);
    } else {
      this.emit("verbose", message, undefined, contextOrMeta);
    }
  }
}

/**
 * Creates a {@link Logger} bound to a request id so every line it emits
 * carries the id. Kept for backward compatibility — new code should rely on
 * the ALS request context set by the HTTP adapter instead.
 */
export function createRequestLogger(requestId: string, context?: string): Logger {
  return new Logger(context, requestId);
}
