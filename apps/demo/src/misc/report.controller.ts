import { Controller, Get, Param } from "../../../../src/common/index.ts";

/**
 * Single-action controller: the verb decorator sits on the class itself and the
 * logic lives in `handle`. No method-level route decorator is required.
 */
@Controller("reports")
@Get("/:id")
export class ShowReport {
  handle(@Param("id") id: string) {
    return { id, generatedAt: new Date().toISOString() };
  }
}
