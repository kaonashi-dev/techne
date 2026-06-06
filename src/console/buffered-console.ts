import { Console } from "./console.service";

export class BufferedConsole extends Console {
  out = "";
  err = "";

  write(t: string) {
    this.out += t;
  }

  writeln(t = "") {
    this.out += t + "\n";
  }

  line(t = "") {
    this.writeln(t);
  }

  info(t: string) {
    this.writeln(t);
  }

  success(t: string) {
    this.writeln(`✓ ${t}`);
  }

  warning(t: string) {
    this.writeln(`⚠ ${t}`);
  }

  error(t: string) {
    this.err += `✗ ${t}\n`;
  }

  get all() {
    return this.out + this.err;
  }
}
