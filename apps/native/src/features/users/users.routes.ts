import { createApp, problem, status, t } from "../../../../../src";
import type { UsersService } from "./users.service";

const UserSchema = t.Object({ id: t.String(), name: t.String() });

export function usersRoutes(users: UsersService) {
  return createApp({ prefix: "/users" })
    .get(
      "/:id",
      {
        params: t.Object({ id: t.String({ minLength: 1 }) }),
      },
      ({ params }) =>
        users.find(params.id) ??
        problem(404, {
          detail: "User not found",
          code: "users.not_found",
        }),
    )
    .post(
      "/",
      {
        body: t.Object({ name: t.String({ minLength: 1, pattern: "\\S" }) }),
        response: { 201: UserSchema },
      },
      ({ body }) => status(201, users.create(body.name)),
    );
}
