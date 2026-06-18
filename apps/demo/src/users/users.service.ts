import {
  ConflictException,
  Inject,
  Injectable,
  InjectLogger,
  Logger,
  NotFoundException,
} from "../../../../src/common/index.ts";
import { API_KEY } from "../tokens";
import type { CreateUserDto, UserRole } from "./dto/create-user.dto";
import type { UpdateUserDto } from "./dto/update-user.dto";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  age?: number;
}

/**
 * In-memory user store. Demonstrates `@Injectable` providers, a context-bound
 * logger via `@InjectLogger`, and a `@Inject(token)` value dependency.
 */
@Injectable()
export class UsersService {
  private readonly users = new Map<string, User>();
  private seq = 0;

  constructor(
    @InjectLogger("UsersService") private readonly logger: Logger,
    @Inject(API_KEY) private readonly apiKey: string,
  ) {
    this.create({ name: "Ada Lovelace", email: "ada@example.com", role: "admin" });
    this.create({ name: "Alan Turing", email: "alan@example.com", role: "editor" });
    this.logger.verbose(`seeded ${this.users.size} users (api key len=${this.apiKey.length})`);
  }

  findAll(page = 1, limit = 10): { data: User[]; page: number; total: number } {
    const all = [...this.users.values()];
    const start = (page - 1) * limit;
    return { data: all.slice(start, start + limit), page, total: all.length };
  }

  findOne(id: string): User {
    const user = this.users.get(id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`, { code: "user.not_found" });
    }
    return user;
  }

  create(input: CreateUserDto): User {
    for (const existing of this.users.values()) {
      if (existing.email === input.email) {
        throw new ConflictException(`Email ${input.email} already registered`, {
          code: "user.email_taken",
        });
      }
    }
    const id = String(++this.seq);
    const user: User = { id, ...input };
    this.users.set(id, user);
    this.logger.log("created user", { id, email: input.email });
    return user;
  }

  update(id: string, patch: UpdateUserDto): User {
    const user = this.findOne(id);
    const updated = { ...user, ...patch };
    this.users.set(id, updated);
    return updated;
  }

  remove(id: string): { id: string; deleted: true } {
    if (!this.users.delete(id)) {
      throw new NotFoundException(`User #${id} not found`, { code: "user.not_found" });
    }
    return { id, deleted: true };
  }
}
