import { Controller, Get, Injectable, Module } from "../src/common";
import { TechneFactory } from "../src/core";

const t0 = Bun.nanoseconds();

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.slice(4) ?? "1");

@Injectable()
class S {
  ping() {
    return "pong";
  }
}

@Controller("ping")
class C {
  constructor(private s: S) {}
  @Get("/")
  ping() {
    return this.s.ping();
  }
}

// Dynamically build N sibling feature modules. The root module imports them
// all so the scanner walks the full graph.
const siblings: any[] = [];
for (let i = 0; i < N; i++) {
  @Injectable()
  class SiblingService {}

  @Module({ providers: [SiblingService], exports: [SiblingService] })
  class SiblingModule {}

  siblings.push(SiblingModule);
}

@Module({
  imports: siblings,
  controllers: [C],
  providers: [S],
})
class AppModule {}

const app = await TechneFactory.create(AppModule, { logger: false });
// Force a handle() to ensure the first request path is JITed too.
await app.handle(new Request("http://localhost/ping"));

const ms = (Bun.nanoseconds() - t0) / 1_000_000;
console.log("READY " + ms.toFixed(3));
await app.close().catch(() => undefined);
