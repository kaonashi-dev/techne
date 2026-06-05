const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

export abstract class Console {
  abstract write(text: string): void;
  abstract writeln(text?: string): void;
  abstract line(text?: string): void;
  abstract info(text: string): void;
  abstract success(text: string): void;
  abstract warning(text: string): void;
  abstract error(text: string): void;
}

export class BunConsole extends Console {
  constructor(private readonly color = process.stdout.isTTY) {
    super();
  }

  private paint(c: keyof typeof ANSI, s: string) {
    return this.color ? `${ANSI[c]}${s}${ANSI.reset}` : s;
  }

  write(text: string) {
    process.stdout.write(text);
  }

  writeln(text = "") {
    process.stdout.write(text + "\n");
  }

  line(text = "") {
    this.writeln(text);
  }

  info(text: string) {
    this.writeln(this.paint("cyan", text));
  }

  success(text: string) {
    this.writeln(`${this.paint("green", "✓")} ${text}`);
  }

  warning(text: string) {
    this.writeln(`${this.paint("yellow", "⚠")} ${text}`);
  }

  error(text: string) {
    process.stderr.write(`${this.paint("red", "✗")} ${text}\n`);
  }
}
