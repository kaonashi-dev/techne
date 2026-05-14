import { afterEach, describe, expect, test } from "bun:test";
import { Injectable } from "../src/common";
import {
  InjectMq,
  MqProcess,
  MqProcessor,
  Queue,
  QueueEvents,
  Worker,
  mq,
  type Job,
} from "../src/mq";
import { TechneFactory } from "../src/factory/techne-factory";
import * as LegacyQueue from "../src/queue";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe("mq", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });
  test("adds and retrieves jobs", async () => {
    const queue = new Queue("emails");
    closers.push(() => queue.close());
    const job = await queue.add("send-welcome", { email: "hello@example.com" });
    expect(await queue.getJobCounts("waiting")).toEqual({ waiting: 1 });
    expect(job.name).toBe("send-welcome");
    expect(job.data).toEqual({ email: "hello@example.com" });
    const stored = await queue.getJob(job.id);
    expect(stored?.id).toBe(job.id);
    expect(stored?.data).toEqual({ email: "hello@example.com" });
  });
  test("processes delayed and retried jobs", async () => {
    const queue = new Queue("notifications");
    const attempts: number[] = [];
    const worker = new Worker(
      queue,
      async (job) => {
        attempts.push(job.attemptsMade);
        if (attempts.length < 3) {
          throw new Error("retry me");
        }
        await job.updateProgress(100);
        return { ok: true };
      },
      {
        concurrency: 1,
        blockTimeout: 10,
        lockDuration: 200,
      },
    );
    closers.push(() => worker.close());
    closers.push(() => queue.close());
    const job = await queue.add("send", { id: 1 }, { delay: 20, attempts: 3, backoff: 10 });
    await sleep(120);
    const stored = await queue.getJob(job.id);
    expect(attempts.length).toBe(3);
    expect(stored?.returnValue).toEqual({ ok: true });
    expect(stored?.progress).toBe(100);
    expect(stored?.finishedOn).toBeDefined();
    expect(await queue.getJobCounts("waiting", "delayed", "completed")).toEqual({
      waiting: 0,
      delayed: 0,
      completed: 1,
    });
  });
  test("emits queue events", async () => {
    const queue = new Queue("reports");
    const events = new QueueEvents("reports", {}, queue.driver);
    const seen: string[] = [];
    events.on("waiting", () => seen.push("waiting"));
    events.on("completed", () => seen.push("completed"));
    const worker = new Worker(
      queue,
      async () => {
        return "done";
      },
      { blockTimeout: 10, lockDuration: 200 },
    );
    closers.push(() => events.close());
    closers.push(() => worker.close());
    closers.push(() => queue.close());
    await sleep(0);
    await queue.add("build", { id: 1 });
    await sleep(40);
    expect(seen).toContain("waiting");
    expect(seen).toContain("completed");
  });
  test("registers processors through decorators and DI", async () => {
    @Injectable()
    class AuditService {
      readonly events: string[] = [];
      constructor(
        @InjectMq("emails")
        private readonly queue: Queue,
      ) {}
      async enqueue(email: string) {
        await this.queue.add("send", { email });
      }
      markProcessed(email: string) {
        this.events.push(email);
      }
    }
    @MqProcessor("emails", { blockTimeout: 10, lockDuration: 200 })
    class EmailProcessor {
      constructor(private readonly audit: AuditService) {}
      @MqProcess("send")
      async handle(
        job: Job<{
          email: string;
        }>,
      ) {
        this.audit.markProcessed(job.data.email);
        return { delivered: true };
      }
    }
    const moduleRef = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [{ name: "emails" }] })],
      providers: [AuditService, EmailProcessor],
      logger: false,
    });
    closers.push(() => moduleRef.close());
    const audit = moduleRef.get<AuditService>(AuditService);
    await audit.enqueue("dev@example.com");
    await sleep(40);
    expect(audit.events).toEqual(["dev@example.com"]);
  });
  test("supports pause/resume and job counts", async () => {
    const queue = new Queue("paused");
    closers.push(() => queue.close());
    await queue.pause();
    await queue.add("one", { ok: 1 });
    await queue.add("two", { ok: 2 }, { delay: 30 });
    expect(await queue.getJobCounts("paused", "delayed", "waiting")).toEqual({
      paused: 1,
      delayed: 1,
      waiting: 0,
    });
    await queue.resume();
    await sleep(40);
    expect(await queue.getJobCounts("waiting", "paused", "delayed")).toEqual({
      waiting: 2,
      paused: 0,
      delayed: 0,
    });
  });
  test("keeps legacy queue subpath as core-only compatibility layer", async () => {
    expect(LegacyQueue.Queue).toBe(Queue);
    expect(LegacyQueue.Worker).toBe(Worker);
    expect(LegacyQueue.QueueEvents).toBe(QueueEvents);
    expect("InjectQueue" in LegacyQueue).toBe(false);
    expect("QueueModule" in LegacyQueue).toBe(false);
  });
});
