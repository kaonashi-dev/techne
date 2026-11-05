import { createApp, createResources, problem, status, t, type Context } from "../../src";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const feature = (service: { find(id: string): { id: string } }) =>
  createApp({ prefix: "/users" }).get("/:id", ({ params }) => service.find(params.id));
const app = createApp().use(feature({ find: (id) => ({ id }) }));
export type NativeRoutes = Assert<
  Equal<
    (typeof app)["~routes"]["/users/:id"]["get"],
    {
      body: unknown;
      params: { id: string };
      query: unknown;
      headers: unknown;
      response: { 200: { id: string } };
    }
  >
>;

const created = createApp({ prefix: "/items" }).post(
  "/",
  { body: t.Object({ name: t.String() }) },
  ({ body }) => (body.name ? status(201, { name: body.name }) : problem(422, { detail: "empty" })),
);
type CreatedResponse = (typeof created)["~routes"]["/items"]["post"]["response"];
export type StatusResponses = Assert<Equal<keyof CreatedResponse, 201 | 422>>;
export type CreatedBody = Assert<Equal<CreatedResponse[201], { name: string }>>;

createApp().get("/files/*", ({ params }) => {
  const rest: string = params["*"];
  // @ts-expect-error Undeclared path parameters do not exist.
  void params.missing;
  return rest;
});

createApp().get("/search", { query: t.Object({ page: t.Number() }) }, ({ query }) => {
  const page: number = query.page;
  return { page };
});

// Generic middleware typed with `Context` plugs into any app.
const middleware = ({ request }: Context) => void request.url;
createApp()
  .beforeHandle(middleware)
  .get("/", () => "ok");

// Derived context is typed in later handlers.
createApp()
  .derive(({ headers }) => ({ user: headers["x-user"] }))
  .get("/me", ({ user }) => {
    const name: string | undefined = user;
    // @ts-expect-error Derived values keep their type.
    const _wrong: number = user;
    return { name };
  });

// Decorations of mounted apps propagate to the parent.
createApp()
  .use(createApp().decorate("clock", { now: () => 1 }))
  .get("/now", ({ clock }) => clock.now());

createApp({ prefix: "/api", as: "global" })
  .decorate("service", { count: () => 1 })
  .post("/count", { body: t.Object({ count: t.Number() }) }, ({ body, service }) => {
    const count: number = body.count + service.count();
    // @ts-expect-error Schemas must not widen the body to any.
    const _wrong: string = body.count;
    // @ts-expect-error Decorated services retain their actual methods.
    service.missing();
    return { count };
  });

// @ts-expect-error Missing dependencies are a compile-time error.
feature();
// @ts-expect-error Prefixes must be strings.
createApp({ prefix: 123 });

const resources = await createResources(() => ({ database: { query: () => 1 } }));
const _result: number = resources.value.database.query();
// @ts-expect-error Resource types are inferred, not a token lookup returning any.
void resources.value.missing;
await resources.close();
