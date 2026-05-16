import { afterEach, describe, expect, test } from "bun:test";
import { resolveTechneMode } from "../src/common/mode";
import { TechneFactory } from "../src/factory/techne-factory";
import { Injectable } from "../src/common";
import { InjectMq, Queue, getMqToken, mq, type Job } from "../src/mq";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("resolveTechneMode", () => {
  const origEnv = process.env.TECHNE_MODE;
  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.TECHNE_MODE;
    } else {
      process.env.TECHNE_MODE = origEnv;
    }
  });

  test("defaults to 'all' when env is unset and no override", () => {
    delete process.env.TECHNE_MODE;
    expect(resolveTechneMode()).toBe("all");
  });

  test("reads TECHNE_MODE env var", () => {
    process.env.TECHNE_MODE = "server";
    expect(resolveTechneMode()).toBe("server");
    process.env.TECHNE_MODE = "worker";
    expect(resolveTechneMode()).toBe("worker");
    process.env.TECHNE_MODE = "all";
    expect(resolveTechneMode()).toBe("all");
  });

  test("explicit override takes precedence over env var", () => {
    process.env.TECHNE_MODE = "server";
    expect(resolveTechneMode("worker")).toBe("worker");
    expect(resolveTechneMode("all")).toBe("all");
  });

  test("throws on invalid override", () => {
    expect(() => resolveTechneMode("invalid" as any)).toThrow(/Invalid TECHNE_MODE/);
  });

  test("throws on invalid env var", () => {
    process.env.TECHNE_MODE = "bad-value";
    expect(() => resolveTechneMode()).toThrow(/Invalid TECHNE_MODE/);
  });
});

describe("mode end-to-end", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });

  test("server mode: queues injectable for publishing but jobs not processed", async () => {
    const processed: any[] = [];

    @Queue("server-e2e", { blockTimeout: 10, lockDuration: 200 })
    class ServerE2eProcessor {
      async handle(job: Job) {
        processed.push(job.data);
        return "done";
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      mode: "server",
      plugins: [mq({ queues: [{ name: "server-e2e" }] })],
      providers: [ServerE2eProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    const queue = ctx.get<any>(getMqToken("server-e2e"));
    await queue.add("task", { x: 1 });
    await sleep(40);

    expect(processed).toHaveLength(0);
    const counts = await queue.getJobCounts("waiting", "completed");
    expect(counts.waiting).toBe(1);
    expect(counts.completed ?? 0).toBe(0);
  });

  test("worker mode: jobs processed, HTTP listen() is a no-op", async () => {
    const processed: any[] = [];

    @Injectable()
    class WorkerPublisher {
      constructor(@InjectMq("worker-e2e") private readonly queue: any) {}
      async send(data: any) {
        await this.queue.add("task", data);
      }
    }

    @Queue("worker-e2e", { blockTimeout: 10, lockDuration: 200 })
    class WorkerE2eProcessor {
      async handle(job: Job) {
        processed.push(job.data);
        return "done";
      }
    }

    const app = await TechneFactory.create({
      mode: "worker",
      plugins: [mq({ queues: [{ name: "worker-e2e" }] })],
      providers: [WorkerPublisher, WorkerE2eProcessor],
      controllers: [],
      logger: false,
    });
    closers.push(() => app.close());

    await app.listen(9999);
    // HTTP should not be bound
    expect(app.getUrl()).toBeUndefined();

    const publisher = app.get<WorkerPublisher>(WorkerPublisher);
    await publisher.send({ y: 2 });
    await sleep(40);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual({ y: 2 });
  });

  test("all mode (default): both HTTP and workers active", async () => {
    const processed: any[] = [];

    @Queue("all-e2e", { blockTimeout: 10, lockDuration: 200 })
    class AllE2eProcessor {
      async handle(job: Job) {
        processed.push(job.data);
        return "done";
      }
    }

    const app = await TechneFactory.create({
      plugins: [mq({ queues: [{ name: "all-e2e" }] })],
      providers: [AllE2eProcessor],
      controllers: [],
      logger: false,
    });
    closers.push(() => app.close());

    await app.listen(0);
    expect(app.getUrl()).toBeDefined();

    const queue = app.get<any>(getMqToken("all-e2e"));
    await queue.add("task", { z: 3 });
    await sleep(40);

    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual({ z: 3 });
  });
});
