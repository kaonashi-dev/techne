import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Get, Post } from "../src/decorators/routes.decorator";
import { Body, FileInterceptor, HealthCheck, UploadedFile, UseInterceptors } from "../src/common";
import { TechneFactory } from "../src/factory/techne-factory";
import { HealthCheckService } from "../src/health";
import { DocumentBuilder, SwaggerModule } from "../src/swagger";
describe("swagger, health and upload", () => {
    test("generates a basic OpenAPI document and serves it through SwaggerModule.setup", async () => {
        @Controller("users")
        class UsersController {
            @Post("/")
            create(
            @Body()
            body: any) {
                return body;
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [UsersController] },
            ...{ logger: false }
        });
        const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("Test API").setVersion("1.0.0").build());
        expect(document.info.title).toBe("Test API");
        expect(document.paths["/users"].post).toBeDefined();
        SwaggerModule.setup("/api-docs", app, document);
        const response = await app.handle(new Request("http://localhost/api-docs"));
        expect(response.status).toBe(200);
        expect((await response.json()).paths["/users"].post).toBeDefined();
    });
    test("extracts uploaded files and supports health checks", async () => {
        @Controller("ops")
        class OpsController {
            constructor(private readonly health: HealthCheckService) { }
            @UseInterceptors(FileInterceptor("file"))
            @Post("/upload")
            upload(
            @UploadedFile("file")
            file: any) {
                return { name: file?.name ?? null };
            }
            @HealthCheck()
            @Get("/health")
            async healthCheck() {
                return this.health.check([
                    this.health.pingCheck("app"),
                    this.health.memoryCheck("memory", Number.MAX_SAFE_INTEGER),
                ]);
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [OpsController], providers: [HealthCheckService] },
            ...{ logger: false }
        });
        const upload = await app.handle(new Request("http://localhost/ops/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: { name: "avatar.txt" } }),
        }));
        expect(upload.status).toBe(200);
        expect(await upload.json()).toEqual({ name: "avatar.txt" });
        const health = await app.handle(new Request("http://localhost/ops/health"));
        expect(health.status).toBe(200);
        expect(await health.json()).toMatchObject({
            status: "ok",
            info: {
                app: { status: "up" },
            },
        });
    });
});
