import { Catch } from "../../../../src/common/index.ts";
import type { ExceptionFilter, ResponseHookContext } from "../../../../src/common/index.ts";

/** Domain error thrown by a handler to demonstrate a scoped exception filter. */
export class DomainRuleError extends Error {
  constructor(
    message: string,
    readonly rule: string,
  ) {
    super(message);
    this.name = "DomainRuleError";
  }
}

/**
 * A `@Catch`-scoped `ExceptionFilter`. It only handles {@link DomainRuleError};
 * everything else falls through to Techne's RFC 7807 problem-document handler.
 */
@Catch(DomainRuleError)
export class DomainRuleFilter implements ExceptionFilter<DomainRuleError> {
  catch(exception: DomainRuleError, host: ResponseHookContext): unknown {
    host.ctx.set.status = 422;
    return {
      error: "domain_rule_violation",
      rule: exception.rule,
      message: exception.message,
    };
  }
}
