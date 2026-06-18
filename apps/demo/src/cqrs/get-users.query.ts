import { CqrsQuery } from "../../../../src/cqrs/index.ts";
import type { StoredUser } from "./cqrs-store.service";

export class GetUsersQuery extends CqrsQuery<Record<string, never>, StoredUser[]> {}
