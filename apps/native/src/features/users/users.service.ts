export interface User {
  id: string;
  name: string;
}

/** Port owned by the feature, implemented by infrastructure or a test fake. */
export interface UsersRepository {
  find(id: string): User | undefined;
  save(user: User): void;
}

export function createUsersService(repository: UsersRepository, nextId: () => string) {
  return {
    find: (id: string) => repository.find(id),
    create(name: string): User {
      const user = { id: nextId(), name: name.trim() };
      if (!user.name) throw new Error("A user name cannot be blank");
      repository.save(user);
      return user;
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
