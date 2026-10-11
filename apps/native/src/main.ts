import { buildApp } from "./app";
import { createMemoryUsers } from "./infrastructure/memory-users";

const app = buildApp({ users: createMemoryUsers(), nextId: () => crypto.randomUUID() }).listen({
  port: Number(Bun.env.PORT ?? 3000),
  hostname: Bun.env.HOST ?? "0.0.0.0",
});

let stopping: Promise<unknown> | undefined;
const stop = () => (stopping ??= Promise.resolve(app.stop()));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
