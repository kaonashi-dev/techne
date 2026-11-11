import { buildApp } from "./app";
import { createMemoryUsers } from "./infrastructure/memory-users";

if (process.argv.includes("--healthcheck")) {
  const port = Number(Bun.env.PORT ?? 3000);
  const healthy = await fetch(`http://127.0.0.1:${port}/healthz`)
    .then((response) => response.ok)
    .catch(() => false);
  process.exit(healthy ? 0 : 1);
}

const app = buildApp({ users: createMemoryUsers(), nextId: () => crypto.randomUUID() }).listen({
  port: Number(Bun.env.PORT ?? 3000),
  hostname: Bun.env.HOST ?? "0.0.0.0",
});

let stopping: Promise<unknown> | undefined;
const stop = () => (stopping ??= Promise.resolve(app.stop()));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
