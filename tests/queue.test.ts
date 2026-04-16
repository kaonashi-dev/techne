import { afterEach, describe, expect, test } from "bun:test";
import { Injectable } from "../src/common";
import {
  InjectQueue,
  Process,
  Processor,
  Queue,
  QueueEvents,
  QueueModule,
  Worker,
  type Job,
} from "../src/queue";
import { Test } from "../src/testing";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Queue", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });

  test("adds and retrieves jobs", async () => {
    const queue = new Queue("emails");
    closers.push(() => queue.close());

    const job = await queue.add("send-welcome", { email: "hello@example.com" });

    expect(await queue.count()).toBe(1);
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
        drainDelay: 5,
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
    expect(await queue.count()).toBe(0);
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
      { drainDelay: 5, lockDuration: 200 },
    );

    closers.push(() => events.close());
    closers.push(() => worker.close());
    closers.push(() => queue.close());

    await queue.add("build", { id: 1 });
    await sleep(40);

    expect(seen).toContain("waiting");
    expect(seen).toContain("completed");
  });

  test("registers processors through decorators and DI", async () => {
    @Injectable()
    class AuditService {
      readonly events: string[] = [];

      constructor(@InjectQueue("emails") private readonly queue: Queue) {}

      async enqueue(email: string) {
        await this.queue.add("send", { email });
      }

      markProcessed(email: string) {
        this.events.push(email);
      }
    }

    @Processor("emails", { drainDelay: 5, lockDuration: 200 })
    class EmailProcessor {
      constructor(private readonly audit: AuditService) {}

      @Process("send")
      async handle(job: Job<{ email: string }>) {
        this.audit.markProcessed(job.data.email);
        return { delivered: true };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [QueueModule.register(), QueueModule.registerQueue({ name: "emails" })],
      providers: [AuditService, EmailProcessor],
    }).compile();
    const audit = moduleRef.get<AuditService>(AuditService);

    await audit.enqueue("dev@example.com");
    await sleep(40);

    expect(audit.events).toEqual(["dev@example.com"]);
  });
});
