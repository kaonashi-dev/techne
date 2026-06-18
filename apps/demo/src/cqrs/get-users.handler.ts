import { Injectable } from "../../../../src/common/index.ts";
import { QueryHandler } from "../../../../src/cqrs/index.ts";
import type { IQueryHandler } from "../../../../src/cqrs/index.ts";
import { CqrsStore, type StoredUser } from "./cqrs-store.service";
import { GetUsersQuery } from "./get-users.query";

@QueryHandler(GetUsersQuery)
@Injectable()
export class GetUsersHandler implements IQueryHandler<GetUsersQuery, StoredUser[]> {
  constructor(private readonly store: CqrsStore) {}

  execute(_query: GetUsersQuery): StoredUser[] {
    return this.store.list();
  }
}
