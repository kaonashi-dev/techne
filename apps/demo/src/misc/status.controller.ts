import {
  Body,
  Controller,
  CsrfExempt,
  Get,
  Post,
  Req,
  Schema,
  UseFilters,
  UseGuards,
} from "../../../../src/common/index.ts";
import { InjectConfig } from "../../../../src/config/index.ts";
import type { AppConfigType } from "../config/app.config";
import { ApiKeyGuard } from "../common/api-key.guard";
import { DomainRuleError, DomainRuleFilter } from "../common/http-exception.filter";

/** Inline TypeBox schema authored with the `Schema` helper. */
const EchoSchema = Schema.Object({
  message: Schema.String({ minLength: 1 }),
});

/**
 * Demonstrates `@InjectConfig`, a hand-written guard via `@UseGuards`, an inline
 * `Schema` body, the raw `@Req` object, and a `@UseFilters` exception filter.
 * Every route here requires a valid `x-api-key` header.
 */
@Controller("status")
@CsrfExempt()
@UseGuards(ApiKeyGuard)
@UseFilters(DomainRuleFilter)
export class StatusController {
  constructor(@InjectConfig() private readonly config: AppConfigType) {}

  @Get("/")
  status(@Req() request: Request) {
    return {
      app: this.config.get("APP_NAME") ?? "techne-demo",
      method: request.method,
      time: new Date().toISOString(),
    };
  }

  @Post("/echo", { body: EchoSchema })
  echo(@Body() body: { message: string }) {
    return { echoed: body.message };
  }

  @Get("/boom")
  boom() {
    // Caught by DomainRuleFilter → 422 with a custom body.
    throw new DomainRuleError("Resource is locked for editing", "resource.locked");
  }
}
