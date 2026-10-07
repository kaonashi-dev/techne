import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Console commands still belong to the opt-in decorator runtime. */
export async function generateCommand(name: string) {
  const base = name.replace(/Command$/i, "");
  const className = `${base.charAt(0).toUpperCase() + base.slice(1)}Command`;
  const kebab = base
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .toLowerCase();
  const content = `import { Injectable } from "@kaonashi-dev/techne/common";
import { ConsoleCommand, Argument, Console } from "@kaonashi-dev/techne/console";

@Injectable()
export class ${className} {
  constructor(private readonly console: Console) {}

  @ConsoleCommand("${kebab}", { description: "Run the ${kebab} command" })
  handle(@Argument("name") name: string) {
    this.console.success(\`Hello, \${name}!\`);
  }
}
`;
  const outDir = path.join(process.cwd(), "src", "commands");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, `${kebab}.command.ts`), content, { flag: "wx" });
  console.log(`CREATE src/commands/${kebab}.command.ts`);
}
