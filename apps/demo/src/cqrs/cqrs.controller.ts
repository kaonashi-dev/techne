import { Body, Controller, CsrfExempt, Get, Post } from "../../../../src/common/index.ts";
import { ModuleRef } from "../../../../src/core/index.ts";
import { CommandBus, QueryBus } from "../../../../src/cqrs/index.ts";
import { CreateCqrsUserDto } from "./create-cqrs-user.dto";
import { CreateUserCommand } from "./create-user.command";
import { GetUsersQuery } from "./get-users.query";

/**
 * Drives the command and query buses from HTTP.
 *
 * The buses are resolved lazily through `ModuleRef` because the framework
 * registers the CQRS buses after static providers/controllers are constructed —
 * resolving at request time guarantees we get the buses that have handlers bound.
 */
@Controller("cqrs/users")
@CsrfExempt()
export class CqrsController {
  constructor(private readonly moduleRef: ModuleRef) {}

  @Post("/")
  async create(@Body(CreateCqrsUserDto) body: CreateCqrsUserDto) {
    const commandBus = this.moduleRef.get<CommandBus>(CommandBus);
    await commandBus.execute(new CreateUserCommand({ name: body.name, email: body.email }));
    return { accepted: true };
  }

  @Get("/")
  list() {
    const queryBus = this.moduleRef.get<QueryBus>(QueryBus);
    return queryBus.execute(new GetUsersQuery({}));
  }
}
