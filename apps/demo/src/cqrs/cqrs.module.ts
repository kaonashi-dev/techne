import { defineFeature } from "../../../../src/core/index.ts";
import { CqrsController } from "./cqrs.controller";
import { CqrsStore } from "./cqrs-store.service";
import { CreateUserHandler } from "./create-user.handler";
import { GetUsersHandler } from "./get-users.handler";
import { UserCreatedLogger } from "./user-created.handler";

export const CqrsFeature = defineFeature({
  controllers: [CqrsController],
  providers: [CqrsStore, CreateUserHandler, GetUsersHandler, UserCreatedLogger],
});
