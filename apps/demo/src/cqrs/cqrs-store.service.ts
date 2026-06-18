import { Injectable } from "../../../../src/common/index.ts";

export interface StoredUser {
  id: number;
  name: string;
  email: string;
}

/** Tiny shared read-model populated by the command side, read by the query side. */
@Injectable()
export class CqrsStore {
  private readonly users: StoredUser[] = [];
  private seq = 0;

  add(name: string, email: string): StoredUser {
    const user: StoredUser = { id: ++this.seq, name, email };
    this.users.push(user);
    return user;
  }

  list(): StoredUser[] {
    return [...this.users];
  }
}
