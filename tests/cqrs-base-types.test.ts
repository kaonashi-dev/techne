import { describe, expect, test } from "bun:test";
import { Command, CqrsQuery, DomainEvent, InMemoryEventStore } from "../src/cqrs";

class CreateThing extends Command<{ name: string; count: number }> {}
class FindThing extends CqrsQuery<{ id: string }, { id: string; name: string }> {}
class ThingCreated extends DomainEvent<{ id: string; name: string }> {}

describe("CQRS base types", () => {
  test("Command payload round-trips through readonly property", () => {
    const cmd = new CreateThing({ name: "widget", count: 3 });
    expect(cmd.payload).toEqual({ name: "widget", count: 3 });
    expect(cmd).toBeInstanceOf(Command);
  });

  test("Query payload round-trips through readonly property", () => {
    const q = new FindThing({ id: "abc" });
    expect(q.payload).toEqual({ id: "abc" });
    expect(q).toBeInstanceOf(CqrsQuery);
  });

  test("DomainEvent exposes data and a timestamp", () => {
    const before = Date.now();
    const ev = new ThingCreated({ id: "1", name: "alpha" });
    const after = Date.now();
    expect(ev.data).toEqual({ id: "1", name: "alpha" });
    expect(typeof ev.timestamp).toBe("number");
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(after);
    expect(ev).toBeInstanceOf(DomainEvent);
  });
});

describe("InMemoryEventStore", () => {
  test("append returns a StoredEvent with id/type/data and preserves insertion order", async () => {
    const store = new InMemoryEventStore();
    const a = await store.append("user-1", "user.created", { name: "Ada" });
    const b = await store.append("user-1", "user.renamed", { name: "Ada Lovelace" });
    const c = await store.append("user-1", "user.archived", { reason: "test" });

    for (const ev of [a, b, c]) {
      expect(typeof ev.id).toBe("string");
      expect(ev.id.length).toBeGreaterThan(0);
      expect(ev.aggregateId).toBe("user-1");
      expect(typeof ev.timestamp).toBe("number");
    }

    const all = await store.getAllEvents();
    expect(all.map((e) => e.type)).toEqual(["user.created", "user.renamed", "user.archived"]);
    // ids should be unique
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  test("getEvents filters by aggregate id", async () => {
    const store = new InMemoryEventStore();
    await store.append("user-1", "user.created", { name: "Ada" });
    await store.append("user-2", "user.created", { name: "Grace" });
    await store.append("user-1", "user.renamed", { name: "Ada L." });

    const u1 = await store.getEvents("user-1");
    const u2 = await store.getEvents("user-2");
    const missing = await store.getEvents("nope");

    expect(u1.map((e) => e.type)).toEqual(["user.created", "user.renamed"]);
    expect(u2.map((e) => e.type)).toEqual(["user.created"]);
    expect(missing).toEqual([]);
  });

  test("getEventsByType filters by type", async () => {
    const store = new InMemoryEventStore();
    await store.append("user-1", "user.created", { name: "Ada" });
    await store.append("user-2", "user.created", { name: "Grace" });
    await store.append("user-1", "user.renamed", { name: "Ada L." });

    const created = await store.getEventsByType("user.created");
    expect(created.map((e) => e.aggregateId)).toEqual(["user-1", "user-2"]);
  });
});
