import { afterEach, describe, expect, test } from "bun:test";
import { Injectable } from "../src/common";
import {
  InjectMq,
  InjectQueue,
  MqProcess,
  MqProcessor,
  On,
  Processor,
  Queue,
  QueueEvents,
  Worker,
  defineQueue,
  defineQueueBag,
  getMqToken,
  mq,
  onFor,
  type BagOf,
  type Job,
  type JobOf,
  type QueueBagOf,
  type QueueOf,
} from "../src/mq";
import { Queue as QueueClass } from "../src/mq/queue";
import { MQ_PROCESSOR_METADATA } from "../src/common/constants";
import { TechneFactory } from "../src/factory/techne-factory";
import * as LegacyQueue from "../src/queue";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
describe("mq", () => {
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.allSettled(closers.splice(0).map((close) => close()));
  });
  test("adds and retrieves jobs", async () => {
    const queue = new QueueClass("emails");
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
    const queue = new QueueClass("notifications");
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
    const queue = new QueueClass("reports");
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
    const queue = new QueueClass("paused");
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
  test("@Queue applies the same metadata as @MqProcessor", () => {
    @Queue("equiv-test")
    class WithQueue {}
    @MqProcessor("equiv-test")
    class WithMqProcessor {}
    expect(Reflect.getMetadata(MQ_PROCESSOR_METADATA, WithQueue)).toEqual(
      Reflect.getMetadata(MQ_PROCESSOR_METADATA, WithMqProcessor),
    );
  });
  test("handle() on @Queue class is auto-discovered as default handler", async () => {
    const processed: any[] = [];
    @Queue("auto-handle", { blockTimeout: 10, lockDuration: 200 })
    class AutoHandleProcessor {
      async handle(job: Job) {
        processed.push(job.data);
        return "handled";
      }
    }
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [{ name: "auto-handle" }] })],
      providers: [AutoHandleProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());
    const queue = ctx.get<any>(getMqToken("auto-handle"));
    await queue.add("any-job-name", { n: 42 });
    await sleep(40);
    expect(processed).toHaveLength(1);
    expect(processed[0]).toEqual({ n: 42 });
  });
  test("defineQueue + @Processor + @On wire end-to-end via the mq plugin", async () => {
    const PayinsQueue = defineQueue({
      name: "payins-contract",
      jobs: {
        "initiate-payin": {} as { payinId: string },
        "settle-payins": {} as Record<string, never>,
      },
    });

    const initiated: string[] = [];
    const settled: number[] = [];

    const PayinsOn = onFor(PayinsQueue);

    @Injectable()
    class PayinsService {
      constructor(
        @InjectQueue(PayinsQueue)
        readonly queue: QueueOf<typeof PayinsQueue>,
      ) {}
      enqueue(payinId: string) {
        return this.queue.add("initiate-payin", { payinId });
      }
    }

    @Processor(PayinsQueue, { blockTimeout: 10, lockDuration: 200 })
    class PayinsProcessor {
      @PayinsOn("initiate-payin")
      initiate(job: JobOf<typeof PayinsQueue, "initiate-payin">) {
        initiated.push(job.data.payinId);
      }
      @On("settle-payins")
      settle(_job: Job) {
        settled.push(Date.now());
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [PayinsQueue] })],
      providers: [PayinsService, PayinsProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    const service = ctx.get<PayinsService>(PayinsService);
    await service.enqueue("pi_123");
    await service.queue.add("settle-payins", {});
    await sleep(40);

    expect(initiated).toEqual(["pi_123"]);
    expect(settled).toHaveLength(1);
  });

  test("defineQueue produces a frozen def usable as @InjectQueue token", async () => {
    const Notifications = defineQueue({
      name: "notifications-contract",
      jobs: { ping: {} as { id: number } },
    });

    expect(Notifications.name).toBe("notifications-contract");
    expect(Object.isFrozen(Notifications)).toBe(true);

    @Injectable()
    class Producer {
      constructor(
        @InjectQueue(Notifications)
        readonly queue: QueueOf<typeof Notifications>,
      ) {}
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Notifications] })],
      providers: [Producer],
      logger: false,
    });
    closers.push(() => ctx.close());

    const producer = ctx.get<Producer>(Producer);
    const injected = ctx.get<unknown>(getMqToken(Notifications.name));
    expect(producer.queue).toBe(injected);

    const job = await producer.queue.add("ping", { id: 7 });
    expect(job.data).toEqual({ id: 7 });
  });

  test("InjectQueue rejects an empty token", () => {
    expect(() => InjectQueue("")).toThrow(/non-empty queue name/);
  });

  test("@InjectQueue([A, B]) yields a name-keyed bag of typed queues", async () => {
    const Payins = defineQueue({
      name: "payins-bag",
      jobs: { "initiate-payin": {} as { payinId: string } },
    });
    const Alerts = defineQueue({
      name: "alerts-bag",
      jobs: { warn: {} as { msg: string } },
    });

    @Injectable()
    class Producer {
      constructor(
        @InjectQueue([Payins, Alerts])
        readonly queues: QueueBagOf<[typeof Payins, typeof Alerts]>,
      ) {}
      async fire() {
        await this.queues["payins-bag"].add("initiate-payin", { payinId: "pi_99" });
        await this.queues["alerts-bag"].add("warn", { msg: "ok" });
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [Payins, Alerts] })],
      providers: [Producer],
      logger: false,
    });
    closers.push(() => ctx.close());

    const producer = ctx.get<Producer>(Producer);
    await producer.fire();

    expect(producer.queues["payins-bag"]).toBe(ctx.get(getMqToken("payins-bag")));
    expect(producer.queues["alerts-bag"]).toBe(ctx.get(getMqToken("alerts-bag")));
    expect(await producer.queues["payins-bag"].getJobCounts("waiting")).toEqual({ waiting: 1 });
  });

  test("defineQueueBag + @InjectQueue(bag) derives the param type from the bag", async () => {
    const Payins = defineQueue({
      name: "payins-named-bag",
      jobs: { "initiate-payin": {} as { payinId: string } },
    });
    const Alerts = defineQueue({
      name: "alerts-named-bag",
      jobs: { warn: {} as { msg: string } },
    });

    // Single source of truth — keys are user-chosen identifiers (no hyphens).
    const MyBag = defineQueueBag({
      payins: Payins,
      alerts: Alerts,
    });

    @Injectable()
    class Producer {
      constructor(
        @InjectQueue(MyBag)
        readonly queues: BagOf<typeof MyBag>,
      ) {}
      async fire() {
        await this.queues.payins.add("initiate-payin", { payinId: "pi_77" });
        await this.queues.alerts.add("warn", { msg: "x" });
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      // Only the bag is passed — the plugin auto-registers its queues.
      plugins: [mq({ queues: [MyBag] })],
      providers: [Producer],
      logger: false,
    });
    closers.push(() => ctx.close());

    const producer = ctx.get<Producer>(Producer);
    await producer.fire();

    expect(producer.queues.payins).toBe(ctx.get(getMqToken("payins-named-bag")));
    expect(producer.queues.alerts).toBe(ctx.get(getMqToken("alerts-named-bag")));
    expect(await producer.queues.payins.getJobCounts("waiting")).toEqual({ waiting: 1 });
    expect(await producer.queues.alerts.getJobCounts("waiting")).toEqual({ waiting: 1 });
  });

  test("defineQueue(class) derives queue name + jobs from method signatures", async () => {
    class PayinsQueueClass {
      initiatePayin(_: { payinId: string }) {}
      postProcessPayin(_: { payinId: string; newStatus: string }) {}
      settle() {}
    }

    const PayinsDef = defineQueue(PayinsQueueClass, { name: "payins-from-class" });

    expect(PayinsDef.name).toBe("payins-from-class");
    expect(Object.keys(PayinsDef.jobs).sort()).toEqual([
      "initiatePayin",
      "postProcessPayin",
      "settle",
    ]);

    const processed: Array<{ name: string; data: unknown }> = [];

    @Injectable()
    class Producer {
      constructor(
        @InjectQueue(PayinsDef)
        readonly queue: QueueOf<typeof PayinsDef>,
      ) {}
      async kickoff(id: string) {
        await this.queue.add("initiatePayin", { payinId: id });
        await this.queue.add("postProcessPayin", { payinId: id, newStatus: "OK" });
        await this.queue.add("settle", {});
      }
    }

    @Processor(PayinsDef, { blockTimeout: 10, lockDuration: 200 })
    class PayinsProcessor {
      @On("initiatePayin")
      onInitiate(job: JobOf<typeof PayinsDef, "initiatePayin">) {
        processed.push({ name: "initiatePayin", data: job.data });
      }
      @On("postProcessPayin")
      onPost(job: JobOf<typeof PayinsDef, "postProcessPayin">) {
        processed.push({ name: "postProcessPayin", data: job.data });
      }
      @On("settle")
      onSettle(_job: Job) {
        processed.push({ name: "settle", data: null });
      }
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [PayinsDef] })],
      providers: [Producer, PayinsProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());

    const producer = ctx.get<Producer>(Producer);
    await producer.kickoff("pi_42");
    await sleep(60);

    const names = processed.map((p) => p.name).sort();
    expect(names).toEqual(["initiatePayin", "postProcessPayin", "settle"]);
  });

  test("defineQueue(class) defaults the queue name to the class's runtime name", () => {
    class NotificationsQueue {
      ping(_: { id: number }) {}
    }
    const def = defineQueue(NotificationsQueue);
    expect(def.name).toBe("NotificationsQueue");
    expect(Object.keys(def.jobs)).toEqual(["ping"]);
  });

  test("queue bag throws a clear error for unregistered queues", async () => {
    @Injectable()
    class BadConsumer {
      constructor(
        @InjectQueue([] as readonly any[])
        readonly queues: Record<string, Queue>,
      ) {}
    }

    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [] })],
      providers: [BadConsumer],
      logger: false,
    });
    closers.push(() => ctx.close());

    const consumer = ctx.get<BadConsumer>(BadConsumer);
    expect(() => consumer.queues["missing"]).toThrow(/not registered/);
  });

  test("@MqProcess takes precedence over handle()", async () => {
    const welcomed: any[] = [];
    const handled: any[] = [];
    @Queue("priority-test", { blockTimeout: 10, lockDuration: 200 })
    class PriorityProcessor {
      @MqProcess("welcome")
      async sendWelcome(job: Job) {
        welcomed.push(job.data);
        return "welcomed";
      }
      async handle(job: Job) {
        handled.push(job.data);
        return "handled";
      }
    }
    const ctx = await TechneFactory.createApplicationContext({
      plugins: [mq({ queues: [{ name: "priority-test" }] })],
      providers: [PriorityProcessor],
      logger: false,
    });
    closers.push(() => ctx.close());
    const queue = ctx.get<any>(getMqToken("priority-test"));
    await queue.add("welcome", { user: "alice" });
    await sleep(40);
    expect(welcomed).toHaveLength(1);
    expect(welcomed[0]).toEqual({ user: "alice" });
    expect(handled).toHaveLength(0);
  });
});
