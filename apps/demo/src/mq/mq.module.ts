import { defineFeature } from "../../../../src/core/index.ts";
import { EmailProcessor } from "./email.processor";
import { MqController } from "./mq.controller";

export const MqFeature = defineFeature({
  controllers: [MqController],
  providers: [EmailProcessor],
});
