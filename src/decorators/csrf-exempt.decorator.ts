import { SetMetadata } from "./set-metadata.decorator";

/** Metadata key used to mark a route or controller as exempt from CSRF checking. */
export const CSRF_EXEMPT_METADATA = "__csrf_exempt__";

/**
 * Marks a controller method (or entire controller) as exempt from CSRF
 * double-submit validation. Use this for routes that authenticate via
 * Bearer tokens or receive webhook payloads signed by a third party.
 *
 * ```ts
 * @Post("/webhooks/stripe")
 * @CsrfExempt()
 * handleStripeWebhook(@Body() payload: unknown) {}
 * ```
 */
export function CsrfExempt(): MethodDecorator & ClassDecorator {
  return SetMetadata(CSRF_EXEMPT_METADATA, true);
}
