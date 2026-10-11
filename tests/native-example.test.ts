import { expect, test } from "bun:test";
import { buildApp } from "../apps/native/src/app";
import { createMemoryUsers } from "../apps/native/src/infrastructure/memory-users";

test("reference feature validates input, persists users and isolates app instances", async () => {
  const first = buildApp({ users: createMemoryUsers(), nextId: () => "user-1" });
  const second = buildApp({ users: createMemoryUsers(), nextId: () => "user-2" });
  const created = await first.handle(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: " Ada " }),
    }),
  );
  expect(created.status).toBe(201);
  expect(await created.json()).toEqual({ id: "user-1", name: "Ada" });
  const user = new Request("http://localhost/users/user-1");
  expect(await (await first.handle(user)).json()).toEqual({ id: "user-1", name: "Ada" });
  const missing = await second.handle(user);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ code: "users.not_found" });
  const invalid = await first.handle(
    new Request("http://localhost/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    }),
  );
  expect(invalid.status).toBe(422);
});
