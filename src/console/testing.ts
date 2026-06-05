import { TechneFactory } from "../factory/techne-factory";
import { BufferedConsole } from "./buffered-console";
import type { AppBootstrapConfig } from "../factory/techne-factory";

export async function createConsoleTester(config: AppBootstrapConfig) {
  const buffered = new BufferedConsole();
  const app = await TechneFactory.createConsoleApplication(
    { ...config, logger: false },
    { console: buffered },
  );
  return {
    async call(name: string, args: string[] | string = []) {
      const argv = Array.isArray(args) ? args : args.split(/\s+/).filter(Boolean);
      const code = await app.run(name, argv);
      const output = buffered.all;
      const api = {
        code,
        output,
        assertExitCode(n: number) {
          if (code !== n) throw new Error(`Expected exit ${n}, got ${code}. Output:\n${output}`);
          return api;
        },
        assertSuccess() {
          return api.assertExitCode(0);
        },
        assertSee(text: string) {
          if (!output.includes(text))
            throw new Error(`Expected output to contain "${text}". Got:\n${output}`);
          return api;
        },
      };
      return api;
    },
    async close() {
      await app.close();
    },
  };
}
