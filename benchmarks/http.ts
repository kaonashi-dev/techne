/**
 * HTTP Benchmark — Raw Elysia vs Bnest
 *
 * Measures requests/sec and latency for equivalent endpoints.
 * Run: bun run benchmarks/http.ts
 */

import { Elysia } from "elysia";
import { BnestFactory, Module, Controller, Get, Injectable, Param } from "../src";

// --- Raw Elysia ---
const elysiaApp = new Elysia()
  .get("/users", () => [{ id: 1, name: "Alice" }])
  .get("/users/:id", ({ params }) => ({ id: params.id, name: "Alice" }));

// --- Bnest ---
@Injectable()
class UserService {
  getAll() {
    return [{ id: 1, name: "Alice" }];
  }
  getOne(id: string) {
    return { id, name: "Alice" };
  }
}

@Controller("users")
class UserController {
  constructor(private userService: UserService) {}

  @Get("/")
  findAll() {
    return this.userService.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.userService.getOne(id);
  }
}

@Module({ controllers: [UserController], providers: [UserService] })
class AppModule {}

const bnestApp = await BnestFactory.create(AppModule, { logger: false });

// --- Benchmark ---
const ITERATIONS = 10_000;
const WARMUP = 1_000;

async function bench(name: string, handler: (req: Request) => Promise<Response>) {
  const listReq = new Request("http://localhost/users");
  const paramReq = new Request("http://localhost/users/42");

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await handler(listReq);
    await handler(paramReq);
  }

  // List endpoint
  const listStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await handler(listReq);
  }
  const listDuration = performance.now() - listStart;

  // Param endpoint
  const paramStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await handler(paramReq);
  }
  const paramDuration = performance.now() - paramStart;

  const listRps = Math.round(ITERATIONS / (listDuration / 1000));
  const paramRps = Math.round(ITERATIONS / (paramDuration / 1000));
  const listAvg = (listDuration / ITERATIONS).toFixed(3);
  const paramAvg = (paramDuration / ITERATIONS).toFixed(3);

  console.log(`\n${name}:`);
  console.log(`  GET /users     ${listRps.toLocaleString()} req/s  (avg ${listAvg}ms)`);
  console.log(`  GET /users/:id ${paramRps.toLocaleString()} req/s  (avg ${paramAvg}ms)`);

  return { listRps, paramRps };
}

console.log(
  `Benchmark: ${ITERATIONS.toLocaleString()} iterations, ${WARMUP.toLocaleString()} warmup\n`,
);

const elysia = await bench("Raw Elysia", (req) => elysiaApp.handle(req));
const bnest = await bench("Bnest", (req) => bnestApp.handle(req));

console.log("\n--- Overhead ---");
const listOverhead = ((1 - bnest.listRps / elysia.listRps) * 100).toFixed(1);
const paramOverhead = ((1 - bnest.paramRps / elysia.paramRps) * 100).toFixed(1);
console.log(`  GET /users     ${listOverhead}% slower`);
console.log(`  GET /users/:id ${paramOverhead}% slower`);
