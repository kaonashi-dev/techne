import { Type, type TLiteral, type TSchema } from "@sinclair/typebox";

type PrimitiveEnumValue = string | number;
type EnumLike = Record<string, PrimitiveEnumValue>;

const isPrimitiveEnumValue = (value: unknown): value is PrimitiveEnumValue => {
  return typeof value === "string" || typeof value === "number";
};

const isNumericKey = (key: string): boolean => {
  return key !== "" && Number.isInteger(Number(key));
};

const extractEnumValues = (
  input: EnumLike | readonly PrimitiveEnumValue[],
): PrimitiveEnumValue[] => {
  if (Array.isArray(input)) {
    return [...new Set(input.filter(isPrimitiveEnumValue))];
  }

  const enumInput = input as EnumLike;

  const values = Object.keys(enumInput)
    .filter((key) => !isNumericKey(key))
    .map((key) => enumInput[key])
    .filter(isPrimitiveEnumValue);

  return [...new Set(values)];
};

export function enumType(input: EnumLike | readonly PrimitiveEnumValue[]): TSchema {
  const values = extractEnumValues(input);

  if (values.length === 0) {
    throw new Error("enumType requires at least one enum value");
  }

  const literals = values.map((value) => Type.Literal(value)) as TLiteral<PrimitiveEnumValue>[];

  if (literals.length === 1) {
    return literals[0];
  }

  return Type.Union(
    literals as [
      TLiteral<PrimitiveEnumValue>,
      TLiteral<PrimitiveEnumValue>,
      ...TLiteral<PrimitiveEnumValue>[],
    ],
  );
}
