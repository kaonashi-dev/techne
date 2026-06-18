import { defineFeature } from "../../../../src/core/index.ts";
import { AdminController } from "./admin.controller";
import { AuthController } from "./auth.controller";

export const AuthFeature = defineFeature({
  controllers: [AuthController, AdminController],
  providers: [],
});
