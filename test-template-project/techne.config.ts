import { defineTechneConfig } from "@kaonashi-dev/techne/core";
import { AppModule } from "./src/app.module";

export default defineTechneConfig({
  module: AppModule,
  port: Number(Bun.env.PORT ?? 3000),
  cors: { origin: true },
  logger: "pretty",
});
