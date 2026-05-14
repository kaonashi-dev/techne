import { describe, expect, test } from "bun:test";
import { Controller } from "../src/decorators/controller.decorator";
import { Version } from "../src/decorators/version.decorator";
import { Get } from "../src/decorators/routes.decorator";
import { TechneFactory } from "../src/factory/techne-factory";
describe("HTTP application features", () => {
    test("setGlobalPrefix remaps routes", async () => {
        @Controller("users")
        class UsersController {
            @Get("/")
            list() {
                return { ok: true };
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [UsersController] },
            ...{ logger: false }
        });
        app.setGlobalPrefix("api");
        const response = await app.handle(new Request("http://localhost/api/users"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
    });
    test("URI versioning prefixes versioned routes", async () => {
        @Controller("users")
        class UsersController {
            @Version("1")
            @Get("/")
            list() {
                return { version: 1 };
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [UsersController] },
            ...{ logger: false }
        });
        app.enableVersioning({ type: "uri" });
        const response = await app.handle(new Request("http://localhost/v1/users"));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ version: 1 });
    });
    test("header versioning checks the configured header", async () => {
        @Controller("reports")
        class ReportsController {
            @Version("2")
            @Get("/")
            getReport() {
                return { version: 2 };
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [ReportsController] },
            ...{ logger: false }
        });
        app.enableVersioning({ type: "header", header: "x-api-version" });
        const missing = await app.handle(new Request("http://localhost/reports"));
        expect(missing.status).toBe(404);
        const response = await app.handle(new Request("http://localhost/reports", {
            headers: { "x-api-version": "2" },
        }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ version: 2 });
    });
    test("enableCors adds access control headers", async () => {
        @Controller("cors")
        class CorsController {
            @Get("/")
            ok() {
                return { ok: true };
            }
        }
        const app = await TechneFactory.create({
            ...{ controllers: [CorsController] },
            ...{ logger: false }
        });
        app.enableCors({ origin: true, credentials: true });
        const response = await app.handle(new Request("http://localhost/cors", {
            headers: { origin: "https://example.com" },
        }));
        expect(response.headers.get("access-control-allow-origin")).toBe("https://example.com");
        expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    });
});
