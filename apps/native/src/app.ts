import { createApp } from "../../../src";
import { createUsersService, type UsersRepository } from "./features/users/users.service";
import { usersRoutes } from "./features/users/users.routes";

export interface AppDependencies {
  users: UsersRepository;
  nextId: () => string;
}

/** The composition root: every dependency and feature is visible here. */
export function buildApp(dependencies: AppDependencies) {
  const users = createUsersService(dependencies.users, dependencies.nextId);
  return createApp()
    .get("/healthz", () => ({ healthy: true }))
    .use(usersRoutes(users));
}

export type App = ReturnType<typeof buildApp>;
