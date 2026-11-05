import { t, type Static } from "../../src";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

const user = t.Object({
  id: t.String(),
  name: t.String(),
  age: t.Optional(t.Number()),
});

export type ObjectInference = Assert<
  Equal<Static<typeof user>, { id: string; name: string; age?: number }>
>;

const partial = t.Partial(user);
export type PartialInference = Assert<
  Equal<Static<typeof partial>, { id?: string; name?: string; age?: number }>
>;

const required = t.Required(user);
export type RequiredInference = Assert<
  Equal<Static<typeof required>, { id: string; name: string; age: number }>
>;

const picked = t.Pick(user, ["id", "age"]);
export type PickInference = Assert<Equal<Static<typeof picked>, { id: string; age?: number }>>;

const omitted = t.Omit(user, ["age"]);
export type OmitInference = Assert<Equal<Static<typeof omitted>, { id: string; name: string }>>;

const tuple = t.Tuple([t.String(), t.Number()]);
export type TupleInference = Assert<Equal<Static<typeof tuple>, [string, number]>>;

const record = t.Record(t.String(), t.Number());
export type RecordInference = Assert<Equal<Static<typeof record>, Record<string, number>>>;

const union = t.Union([t.Literal("a"), t.Literal("b")]);
export type UnionInference = Assert<Equal<Static<typeof union>, "a" | "b">>;

const intersection = t.Intersect([t.Object({ id: t.String() }), t.Object({ name: t.String() })]);
export type IntersectInference = Assert<
  Equal<Static<typeof intersection>, { id: string } & { name: string }>
>;

const readonly = t.Readonly(t.Object({ name: t.String() }));
export type ReadonlyInference = Assert<Equal<Static<typeof readonly>, { readonly name: string }>>;

const literal = t.Literal(1);
export type LiteralInference = Assert<Equal<Static<typeof literal>, 1>>;

const any = t.Any();
export type AnyInference = Assert<Equal<Static<typeof any>, unknown>>;

const never = t.Never();
export type NeverInference = Assert<Equal<Static<typeof never>, never>>;

const nullable = t.Null();
export type NullInference = Assert<Equal<Static<typeof nullable>, null>>;
