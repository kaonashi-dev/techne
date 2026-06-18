import { Logger } from "../../../src/common/index.ts";
import { TechneFactory } from "../../../src/core/index.ts";
import { DocumentBuilder, SwaggerModule } from "../../../src/swagger/index.ts";
import config from "../techne.config";

/**
 * Entrypoint. We pass the declarative config object explicitly to
 * `TechneFactory.create()` (rather than relying on cwd-based auto-loading), then
 * attach an auto-generated OpenAPI document before listening.
 *
 * Run from the repository root so the framework and its dependencies resolve:
 *   bun run apps/demo/src/main.ts
 */
const logger = new Logger("Bootstrap");

const app = await TechneFactory.create(config);

const document = SwaggerModule.createAutoDocument(
  app,
  new DocumentBuilder()
    .setTitle("Techne Demo API")
    .setDescription("Reference app exercising the Techne framework.")
    .setVersion("0.1.0"),
);
SwaggerModule.setup("/api-docs", app, document);

const port = Number(Bun.env.PORT ?? config.port ?? 3000);
await app.listen(port, () => {
  logger.log(`🚀 Techne demo listening on http://localhost:${port}`);
  logger.log(`   OpenAPI:  http://localhost:${port}/api-docs`);
  logger.log(`   Metrics:  http://localhost:${port}/metrics`);
  logger.log(`   Health:   http://localhost:${port}/healthz`);
});

export { app };
