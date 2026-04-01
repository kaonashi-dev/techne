import { test, expect, describe, afterEach } from "bun:test";
import { MemoryQueue, DBQueue, Worker } from "./index";

describe("Queue System", () => {
  describe("MemoryQueue", () => {
    test("enqueue and dequeue jobs", () => {
      const queue = new MemoryQueue();

      const job1 = queue.enqueue({ data: 1 });
      const job2 = queue.enqueue({ data: 2 });

      expect(queue.size()).toBe(2);
      expect(job1.status).toBe("pending");
      expect(job1.payload.data).toBe(1);

      const dequeuedJob1 = queue.dequeue();
      expect(dequeuedJob1?.id).toBe(job1.id);
      expect(dequeuedJob1?.status).toBe("processing");
      expect(queue.size()).toBe(1);

      queue.complete(dequeuedJob1!.id);
      expect(dequeuedJob1!.status).toBe("completed");

      const dequeuedJob2 = queue.dequeue();
      expect(dequeuedJob2?.id).toBe(job2.id);
      expect(queue.size()).toBe(0);

      const emptyJob = queue.dequeue();
      expect(emptyJob).toBeNull();
    });

    test("handles failed jobs and retries", () => {
      const queue = new MemoryQueue();
      const job = queue.enqueue({ data: 1 }, { maxAttempts: 2 });

      let dequeued = queue.dequeue();
      expect(dequeued).not.toBeNull();
      expect(queue.size()).toBe(0);

      queue.fail(dequeued!.id, new Error("Failed once"));
      expect(dequeued!.status).toBe("pending");
      expect(dequeued!.attempts).toBe(1);
      expect(queue.size()).toBe(1);

      dequeued = queue.dequeue();
      expect(dequeued?.id).toBe(job.id);

      queue.fail(dequeued!.id, new Error("Failed twice"));
      expect(dequeued!.status).toBe("failed");
      expect(dequeued!.attempts).toBe(2);
      expect(queue.size()).toBe(0);
    });
  });

  describe("DBQueue (SQLite)", () => {
    let queue: DBQueue;

    afterEach(() => {
      if (queue) queue.clear();
    });

    test("enqueue and dequeue jobs in SQLite", () => {
      queue = new DBQueue(":memory:", "test_jobs");

      const job1 = queue.enqueue({ data: "hello" });
      const job2 = queue.enqueue({ data: "world" });

      expect(queue.size()).toBe(2);

      const dequeued1 = queue.dequeue();
      expect(dequeued1?.id).toBe(job1.id);
      expect(dequeued1?.payload.data).toBe("hello");
      expect(dequeued1?.status).toBe("processing");
      expect(queue.size()).toBe(1);

      queue.complete(dequeued1!.id);

      const dequeued2 = queue.dequeue();
      expect(dequeued2?.id).toBe(job2.id);
      expect(queue.size()).toBe(0);
    });
  });

  describe("Worker", () => {
    test("processes jobs from the queue", async () => {
      const queue = new MemoryQueue();

      let processedCount = 0;
      const worker = new Worker({
        queue,
        concurrency: 2,
        pollingInterval: 10,
        handler: async (job) => {
          processedCount++;
          expect(job.payload.value).toBeGreaterThan(0);
        },
      });

      queue.enqueue({ value: 10 });
      queue.enqueue({ value: 20 });
      queue.enqueue({ value: 30 });

      worker.start();

      // Wait a little bit for the worker to process
      await new Promise((resolve) => setTimeout(resolve, 50));
      worker.stop();

      expect(processedCount).toBe(3);
      expect(queue.size()).toBe(0);
    });

    test("handles job failures gracefully", async () => {
      const queue = new MemoryQueue();

      let attemptCount = 0;
      const worker = new Worker({
        queue,
        concurrency: 1,
        pollingInterval: 10,
        handler: async () => {
          attemptCount++;
          throw new Error("Simulated failure");
        },
      });

      // job should be tried exactly 3 times (maxAttempts = 3)
      queue.enqueue({ value: 10 }, { maxAttempts: 3 });

      worker.start();

      // Wait enough time for 3 attempts
      await new Promise((resolve) => setTimeout(resolve, 100));
      worker.stop();

      expect(attemptCount).toBe(3);
      expect(queue.size()).toBe(0); // Job failed and is no longer pending
    });
  });
});
