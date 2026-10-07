import type { User, UsersRepository } from "../features/users/users.service";

export function createMemoryUsers(): UsersRepository {
  const users = new Map<string, User>();
  return {
    find: (id) => users.get(id),
    save: (user) => {
      users.set(user.id, user);
    },
  };
}
