import { createParamDecorator } from "../../../../src/common/index.ts";

/**
 * Custom parameter decorator built with `createParamDecorator`. Reads the JWT
 * payload that {@link JwtAuthGuard} attaches to the request context.
 *
 * - `@CurrentUser()` → the whole payload
 * - `@CurrentUser("email")` → a single claim
 */
export const CurrentUser = createParamDecorator((data: string | undefined, ctx: any) => {
  const user = ctx?.ctx?.user ?? ctx?.ctx?.request?.user;
  return data ? user?.[data] : user;
});
