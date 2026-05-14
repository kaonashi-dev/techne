import { defineFeature } from "@kaonashi-dev/techne/core";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

export const AppFeature = defineFeature({
  controllers: [AppController],
  providers: [AppService],
});
