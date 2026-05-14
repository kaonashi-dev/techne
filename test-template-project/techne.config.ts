import { defineTechneConfig } from "@kaonashi-dev/techne/core";
import { AppFeature } from "./src/app.module";

export default defineTechneConfig({
  features: [AppFeature],
  port: Number(Bun.env.PORT ?? 3000),
  cors: { origin: true },
  logger: "pretty",
});
