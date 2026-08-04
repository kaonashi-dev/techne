/**
 * Real-socket load benchmark.
 *
 * Every other HTTP scenario in this directory calls `app.handle()` in-process,
 * which is the right call for isolating *framework* cost: no kernel, no socket,
 * no scheduler noise. But it also means the numbers exclude everything the
 * server actually does in production — `Bun.serve`'s accept loop, HTTP parsing,
 * header serialization, and keep-alive handling.
 *
 * This scenario closes that gap. It boots the same two apps on ephemeral ports
 * and drives them over loopback TCP with real `fetch()` calls. Expect the
 * absolute numbers to be an order of magnitude lower than the `handle()`
 * scenarios — that is the socket floor, not a regression. What matters here is
 * the *ratio* between Elysia and Techne: if the in-process gap is 2x but the
 * on-socket gap is 1.1x, the framework overhead is being amortized by transport
 * cost and is not worth optimizing further.
 *
 *   bun run benchmarks/socket.ts
 *   bun run benchmarks/socket.ts --quick --json
 */

import { Elysia } from "elysia";
import { Controller, Get, Injectable, Param } from "../src/common";
import { TechneFactory } from "../src/core";
import {
  emitResults,
  isQuick,
  runScenario,
  type ScenarioOpts,
  type ScenarioResult,
} from "./scenarios";

@Injectable()
class SocketService {
  getAll() {
    return [{ id: 1, name: "Alice" }];
  }
  getOne(id: string) {
    return { id, name: "Alice" };
  }
}

@Controller("users")
class SocketController {
  constructor(private svc: SocketService) {}

  @Get("/")
  findAll() {
    return this.svc.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.svc.getOne(id);
  }
}

/**
 * Socket runs need far fewer requests than the in-process ones: each request
 * costs ~50-100x more wall-clock, so 50k would take minutes. These counts land
 * a full run in roughly the same time budget as the other scenarios.
 *
 * Batch width is also lower. Loopback keep-alive connections are a finite
 * resource and pushing 100-wide saturates the accept queue, which measures
 * Bun's backlog handling rather than the framework.
 */
const SOCKET_OPTS: ScenarioOpts = { total: 20_000, batch: 50, warmup: 1_000, iterations: 5 };
const SOCKET_OPTS_QUICK: ScenarioOpts = { total: 2_000, batch: 50, warmup: 200, iterations: 3 };

export async function runSocketBench(): Promise<ScenarioResult[]> {
  const opts = isQuick() ? SOCKET_OPTS_QUICK : SOCKET_OPTS;

  const elysiaApp = new Elysia()
    .get("/users", () => [{ id: 1, name: "Alice" }])
    .get("/users/:id", ({ params }) => ({ id: params.id, name: "Alice" }));

  const techneApp = await TechneFactory.create({
    controllers: [SocketController],
    providers: [SocketService],
    logger: false,
  });

  const out: ScenarioResult[] = [];

  // Port 0 asks the OS for any free port; read the real one back off the
  // server handle so parallel bench runs can't collide.
  elysiaApp.listen(0);
  const elysiaPort = elysiaApp.server?.port;
  if (elysiaPort === undefined) throw new Error("raw Elysia app failed to bind a port");

  try {
    for (const req of socketRequests(elysiaPort)) {
      out.push(await runScenario("Elysia (socket)", fetchHandler, req, opts));
    }
  } finally {
    elysiaApp.stop();
  }

  // `TechneApplication.listen(0)` deliberately runs the full lifecycle without
  // binding a socket — several tests rely on that to fire plugin `onReady`
  // hooks offline. It still reports a synthesized `getUrl()`, so passing 0 here
  // would benchmark a server that was never listening. Reserve a concrete port
  // instead.
  const technePort = await reservePort();
  await techneApp.listen(technePort);
  await waitForPort(technePort);

  try {
    for (const req of socketRequests(technePort)) {
      out.push(await runScenario("Techne (socket)", fetchHandler, req, opts));
    }
  } finally {
    await techneApp.close();
  }

  return out;
}

/**
 * Ask the OS for a free port by binding one and immediately releasing it.
 * There is a small TOCTOU window before the real server claims it, but the
 * alternative — a hardcoded port — collides with whatever else is on the
 * machine, which is the more common failure in practice.
 */
async function reservePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = probe;
  await probe.stop(true);
  return port;
}

/** Poll until the server accepts connections, so warmup can't race the bind. */
async function waitForPort(port: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/users`).then((r) => r.arrayBuffer());
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`port ${port} never came up`);
      await Bun.sleep(25);
    }
  }
}

/**
 * `runScenario` hands us a `Request`; on the socket path we issue it for real.
 *
 * The body must be drained. An unread `Response` body holds its connection
 * open, so leaving them dangling starves the keep-alive pool a few thousand
 * requests in and the run degrades into connection churn. Draining also makes
 * the measurement honest — a real client pays to read the response.
 */
const fetchHandler = async (req: Request): Promise<Response> => {
  const res = await fetch(req);
  await res.arrayBuffer();
  return res;
};

function socketRequests(port: number | string) {
  const origin = `http://127.0.0.1:${port}`;
  return [
    { label: "GET /users", make: () => new Request(`${origin}/users`) },
    { label: "GET /users/:id", make: () => new Request(`${origin}/users/42`) },
  ];
}

if (import.meta.main) {
  const results = await runSocketBench();
  emitResults(results);
}
