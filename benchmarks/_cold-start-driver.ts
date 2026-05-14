import { Controller, Get, Injectable } from "../src/common";
import { defineFeature, TechneFactory } from "../src/core";

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

const features: any[] = [];
for (let i = 0; i < N; i++) {
  @Injectable()
  class SiblingService {}

  features.push(defineFeature({ providers: [SiblingService] }));
}

const app = await TechneFactory.create({
  features,
  controllers: [C],
  providers: [S],
  logger: false,
});
// Force a handle() to ensure the first request path is JITed too.
await app.handle(new Request("http://localhost/ping"));

const ms = (Bun.nanoseconds() - t0) / 1_000_000;
console.log("READY " + ms.toFixed(3));
await app.close().catch(() => undefined);
