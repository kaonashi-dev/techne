import { Controller, CsrfExempt, Post, UploadedFile } from "../../../../src/common/index.ts";

/**
 * File upload with built-in validation. Violations (too large, wrong MIME,
 * missing) return a 422 problem+json with the standard `errors` array.
 */
@Controller("files")
@CsrfExempt()
export class FilesController {
  @Post("/avatar")
  upload(
    @UploadedFile("avatar", {
      maxSize: 5 * 1024 * 1024,
      mimeTypes: ["image/png", "image/jpeg", "image/*"],
      required: true,
    })
    file: File,
  ) {
    return { name: file.name, size: file.size, type: file.type };
  }
}
