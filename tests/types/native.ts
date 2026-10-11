import { createApp, createResources, Elysia, t } from "../../src";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const feature = (service: { find(id: string): { id: string } }) =>
  createApp({ prefix: "/users" }).get("/:id", ({ params }) => service.find(params.id));
const app = createApp().use(feature({ find: (id) => ({ id }) }));
const raw = new Elysia().use(
  new Elysia({ prefix: "/users" }).get("/:id", ({ params }) => ({ id: params.id })),
);
export type NativeRouteParity = Assert<Equal<(typeof app)["~Routes"], (typeof raw)["~Routes"]>>;

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
