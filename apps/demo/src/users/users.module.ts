import { defineFeature } from "../../../../src/core/index.ts";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

export const UsersFeature = defineFeature({
  controllers: [UsersController],
  providers: [UsersService],
});
