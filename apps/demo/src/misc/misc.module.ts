import { defineFeature } from "../../../../src/core/index.ts";
import { HealthCheckService } from "../../../../src/health/index.ts";
import { ApiKeyGuard } from "../common/api-key.guard";
import { CookiesController } from "./cookies.controller";
import { FilesController } from "./files.controller";
import { HealthController } from "./health.controller";
import { ShowReport } from "./report.controller";
import { StatusController } from "./status.controller";

export const MiscFeature = defineFeature({
  controllers: [ShowReport, FilesController, CookiesController, StatusController, HealthController],
  providers: [HealthCheckService, ApiKeyGuard],
});
