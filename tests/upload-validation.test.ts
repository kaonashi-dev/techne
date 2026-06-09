import { describe, expect, test } from "bun:test";
import { TechneFactory } from "../src/factory/techne-factory";
import { Controller } from "../src/decorators/controller.decorator";
import { Post } from "../src/decorators/routes.decorator";
import { UploadedFile } from "../src/decorators/params.decorator";

// ─── Helper: build a multipart FormData request ──────────────────────────────

function makeUploadRequest(
  url: string,
  fileName: string,
  content: Uint8Array | string,
  mimeType: string,
): Request {
  const fd = new FormData();
  fd.append("avatar", new Blob([content], { type: mimeType }), fileName);
  return new Request(url, { method: "POST", body: fd });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("@UploadedFile validation options", () => {
  test("no options → unchanged behavior (backwards compat)", async () => {
    @Controller("upload-plain")
    class PlainUploadController {
      @Post("/")
      upload(@UploadedFile("avatar") file: any) {
        return { received: file instanceof Blob, size: (file as Blob)?.size ?? 0 };
      }
    }

    const app = await TechneFactory.create({
      controllers: [PlainUploadController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest("http://localhost/upload-plain", "test.png", "hello", "image/png"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(body.size).toBe(5); // "hello" is 5 bytes
  });

  test("maxSize — file within limit → 200", async () => {
    @Controller("upload-size-ok")
    class SizeOkController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { maxSize: 100 })
        file: Blob,
      ) {
        return { size: file.size };
      }
    }

    const app = await TechneFactory.create({
      controllers: [SizeOkController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest("http://localhost/upload-size-ok", "test.png", "hi", "image/png"),
    );
    expect(res.status).toBe(200);
  });

  test("maxSize — file exceeds limit → 422", async () => {
    @Controller("upload-size-err")
    class SizeErrController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { maxSize: 3 })
        file: Blob,
      ) {
        return { size: file.size };
      }
    }

    const app = await TechneFactory.create({
      controllers: [SizeErrController],
      logger: false,
    });

    // 5-byte file exceeds 3-byte limit
    const res = await app.handle(
      makeUploadRequest("http://localhost/upload-size-err", "test.png", "hello", "image/png"),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors).toBeDefined();
    expect(body.errors[0].path).toBe("/avatar");
    expect(body.errors[0].message).toMatch(/exceeds maximum size/i);
  });

  test("mimeTypes — exact match allowed → 200", async () => {
    @Controller("upload-mime-ok")
    class MimeOkController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { mimeTypes: ["image/png", "image/jpeg"] })
        file: Blob,
      ) {
        return { type: file.type };
      }
    }

    const app = await TechneFactory.create({
      controllers: [MimeOkController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest("http://localhost/upload-mime-ok", "test.png", "data", "image/png"),
    );
    expect(res.status).toBe(200);
  });

  test("mimeTypes — exact match rejected → 422", async () => {
    @Controller("upload-mime-err")
    class MimeErrController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { mimeTypes: ["image/png"] })
        file: Blob,
      ) {
        return { type: file.type };
      }
    }

    const app = await TechneFactory.create({
      controllers: [MimeErrController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest(
        "http://localhost/upload-mime-err",
        "test.pdf",
        "data",
        "application/pdf",
      ),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0].path).toBe("/avatar");
    expect(body.errors[0].message).toMatch(/not allowed/i);
  });

  test("mimeTypes — wildcard 'image/*' allows image/png → 200", async () => {
    @Controller("upload-wild-ok")
    class WildOkController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { mimeTypes: ["image/*"] })
        file: Blob,
      ) {
        return { type: file.type };
      }
    }

    const app = await TechneFactory.create({
      controllers: [WildOkController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest("http://localhost/upload-wild-ok", "test.png", "data", "image/png"),
    );
    expect(res.status).toBe(200);
  });

  test("mimeTypes — wildcard 'image/*' rejects application/pdf → 422", async () => {
    @Controller("upload-wild-err")
    class WildErrController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { mimeTypes: ["image/*"] })
        file: Blob,
      ) {
        return { type: file.type };
      }
    }

    const app = await TechneFactory.create({
      controllers: [WildErrController],
      logger: false,
    });

    const res = await app.handle(
      makeUploadRequest(
        "http://localhost/upload-wild-err",
        "doc.pdf",
        "data",
        "application/pdf",
      ),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0].path).toBe("/avatar");
  });

  test("required: true (default), no file → 422", async () => {
    @Controller("upload-req")
    class ReqController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { required: true })
        file: Blob,
      ) {
        return { received: file != null };
      }
    }

    const app = await TechneFactory.create({
      controllers: [ReqController],
      logger: false,
    });

    // Send empty FormData — no "avatar" field
    const fd = new FormData();
    const res = await app.handle(
      new Request("http://localhost/upload-req", { method: "POST", body: fd }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0].path).toBe("/avatar");
    expect(body.errors[0].message).toMatch(/required/i);
  });

  test("required: false, no file → 200 with null", async () => {
    @Controller("upload-opt")
    class OptController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { required: false })
        file: Blob | null,
      ) {
        return { received: file != null };
      }
    }

    const app = await TechneFactory.create({
      controllers: [OptController],
      logger: false,
    });

    const fd = new FormData();
    const res = await app.handle(
      new Request("http://localhost/upload-opt", { method: "POST", body: fd }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(false);
  });

  test("maxSize + mimeTypes combined — both violated → first error is size", async () => {
    @Controller("upload-combo")
    class ComboController {
      @Post("/")
      upload(
        @UploadedFile("avatar", { maxSize: 2, mimeTypes: ["image/png"] })
        _file: Blob,
      ) {
        return { ok: true };
      }
    }

    const app = await TechneFactory.create({
      controllers: [ComboController],
      logger: false,
    });

    // 5-byte file with wrong MIME — size is checked first
    const res = await app.handle(
      makeUploadRequest(
        "http://localhost/upload-combo",
        "doc.pdf",
        "hello",
        "application/pdf",
      ),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors[0].message).toMatch(/exceeds maximum size/i);
  });
});
