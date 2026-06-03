import "../src/reflect-setup";
import { describe, expect, test } from "bun:test";
import {
  ArrayMaxSize,
  ArrayMinSize,
  Dto,
  getDtoSchema,
  getOrCreateDtoSchema,
  getUnknownPropertyKeys,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInteger,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  plainToInstance,
  stripUnknownProperties,
  validate,
  validateDto,
  validateOrReject,
  validateSync,
  ValidateNested,
} from "../src/schema";
import {
  buildSchemaFromClass,
  computeAllValidationErrors,
  firstValidationError,
  getClassPropertyMetadata,
  hasValidationMetadata,
  isValidDto,
  stripUnknownPropertiesWithReport,
} from "../src/schema/dto";

/**
 * Direct unit tests for the standalone `src/schema/dto.ts` API. The existing
 * `tests/dto-validation.test.ts` only drives DTOs through HTTP routes; this
 * file exercises the library functions in isolation — `plainToInstance`,
 * `stripUnknownProperties*`, `getUnknownPropertyKeys`, the `validate*` family,
 * the lazy schema/validator builders, and the schema-inference branches.
 */

enum Role {
  Admin = "admin",
  Editor = "editor",
}

@Dto()
class UserDto {
  @IsString({ minLength: 2 })
  name!: string;
  @IsNumber({ minimum: 0 })
  age!: number;
  @IsBoolean()
  active!: boolean;
}

class AddressDto {
  @IsString()
  city!: string;
}

// A DTO without @Dto() — its schema/validator must be built lazily on demand.
class LazyDto {
  @IsString()
  label!: string;
}

// No decorated members at all → no validation metadata.
class EmptyDto {}

describe("getDtoSchema / getOrCreateDtoSchema / hasValidationMetadata", () => {
  test("@Dto() eagerly registers a schema", () => {
    expect(getDtoSchema(UserDto)).toBeDefined();
    expect(hasValidationMetadata(UserDto)).toBe(true);
  });

  test("a non-@Dto class builds (and caches) its schema lazily", () => {
    expect(getDtoSchema(LazyDto)).toBeUndefined();
    const schema = getOrCreateDtoSchema(LazyDto);
    expect(schema).toBeDefined();
    // Now memoized in the registry.
    expect(getDtoSchema(LazyDto)).toBe(schema!);
    // Second call returns the same cached instance.
    expect(getOrCreateDtoSchema(LazyDto)).toBe(schema!);
  });

  test("a class without validation metadata yields no schema", () => {
    expect(hasValidationMetadata(EmptyDto)).toBe(false);
    expect(getOrCreateDtoSchema(EmptyDto)).toBeUndefined();
  });

  test("getClassPropertyMetadata returns the decorated property map", () => {
    const meta = getClassPropertyMetadata(UserDto);
    expect(Object.keys(meta).sort()).toEqual(["active", "age", "name"]);
    expect(meta.name.type).toBe("string");
  });
});

describe("validateDto / isValidDto / firstValidationError / computeAllValidationErrors", () => {
  test("a valid value produces no errors", () => {
    const value = { name: "Ada", age: 30, active: true };
    expect(validateDto(value, UserDto)).toEqual([]);
    expect(isValidDto(value, UserDto)).toBe(true);
    expect(firstValidationError(value, UserDto)).toBeUndefined();
    expect(computeAllValidationErrors(value, UserDto)).toEqual([]);
  });

  test("an invalid value surfaces property-keyed constraints", () => {
    const value = { name: "A", age: -1, active: "yes" };
    const errors = validateDto(value, UserDto);
    expect(errors.length).toBeGreaterThan(0);
    const props = errors.map((e) => e.property);
    expect(props).toContain("name");
    for (const error of errors) {
      expect(error.constraints).toBeDefined();
    }

    expect(isValidDto(value, UserDto)).toBe(false);
    expect(firstValidationError(value, UserDto)).toBeDefined();
    expect(computeAllValidationErrors(value, UserDto).length).toBeGreaterThanOrEqual(errors.length);
  });

  test("classes without metadata are treated as always-valid", () => {
    expect(validateDto({ anything: 1 }, EmptyDto)).toEqual([]);
    expect(isValidDto({ anything: 1 }, EmptyDto)).toBe(true);
    expect(firstValidationError({ anything: 1 }, EmptyDto)).toBeUndefined();
    expect(computeAllValidationErrors({ anything: 1 }, EmptyDto)).toEqual([]);
  });
});

describe("validate / validateSync / validateOrReject", () => {
  test("validateSync and validate agree on a valid instance", async () => {
    const instance = Object.assign(new UserDto(), { name: "Ada", age: 1, active: false });
    expect(validateSync(instance)).toEqual([]);
    expect(await validate(instance)).toEqual([]);
  });

  test("validateSync reports errors for an invalid instance", () => {
    const instance = Object.assign(new UserDto(), { name: "", age: 5, active: true });
    expect(validateSync(instance).length).toBeGreaterThan(0);
  });

  test("validateOrReject resolves for a valid instance", async () => {
    const instance = Object.assign(new UserDto(), { name: "Ada", age: 1, active: true });
    await expect(validateOrReject(instance)).resolves.toBeUndefined();
  });

  test("validateOrReject throws the error array for an invalid instance", async () => {
    const instance = Object.assign(new UserDto(), { name: "", age: -3, active: true });
    let thrown: unknown;
    try {
      await validateOrReject(instance);
    } catch (error) {
      thrown = error;
    }
    expect(Array.isArray(thrown)).toBe(true);
    expect((thrown as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("nested-validation error normalization", () => {
  class ParentDto {
    @IsString()
    title!: string;
    @ValidateNested()
    address!: AddressDto;
  }

  test("nested failures are nested under children with the right property path", () => {
    const errors = validateDto({ title: "ok", address: { city: 123 } }, ParentDto);
    const addressError = errors.find((e) => e.property === "address");
    expect(addressError).toBeDefined();
    expect(addressError!.children).toBeDefined();
    expect(addressError!.children!.some((c) => c.property === "city")).toBe(true);
  });
});

describe("plainToInstance", () => {
  test("passes null and undefined through unchanged", () => {
    expect(plainToInstance(UserDto, null)).toBeNull();
    expect(plainToInstance(UserDto, undefined)).toBeUndefined();
  });

  test("passes primitives through unchanged", () => {
    expect(plainToInstance(UserDto, "scalar" as unknown)).toBe("scalar");
    expect(plainToInstance(UserDto, 42 as unknown)).toBe(42);
  });

  test("maps arrays element-by-element", () => {
    const result = plainToInstance(UserDto, [
      { name: "a", age: 1, active: true },
      { name: "b", age: 2, active: false },
    ]) as unknown as UserDto[];
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(UserDto);
    expect(result[1]!.name).toBe("b");
  });

  test("uses the fast Object.assign path for DTOs without nested types", () => {
    const instance = plainToInstance(UserDto, { name: "Ada", age: 9, active: true });
    expect(instance).toBeInstanceOf(UserDto);
    expect(instance.name).toBe("Ada");
  });

  test("instantiates a single nested DTO", () => {
    class Outer {
      @IsString()
      name!: string;
      @ValidateNested()
      address!: AddressDto;
    }
    const instance = plainToInstance(Outer, { name: "x", address: { city: "Berlin" } });
    expect(instance).toBeInstanceOf(Outer);
    expect(instance.address).toBeInstanceOf(AddressDto);
    expect(instance.address.city).toBe("Berlin");
  });

  test("maps each element of a nested collection when `each` is set", () => {
    // The runtime element type is carried by `design:type`; we annotate the
    // property with the element class (not an array) so the reflected type
    // resolves to `AddressDto` and the `each` mapping branch runs.
    class Outer {
      @ValidateNested({ each: true })
      addresses!: AddressDto;
    }
    const instance = plainToInstance(Outer, {
      addresses: [{ city: "A" }, { city: "B" }],
    }) as unknown as { addresses: AddressDto[] };
    expect(Array.isArray(instance.addresses)).toBe(true);
    expect(instance.addresses[0]).toBeInstanceOf(AddressDto);
    expect(instance.addresses[1]!.city).toBe("B");
  });

  test("assigns array-typed nested properties raw (element type unknown)", () => {
    class Outer {
      @ValidateNested()
      tags!: AddressDto[]; // design:type is Array → assigned without per-element transform
    }
    const raw = [{ city: "x" }];
    const instance = plainToInstance(Outer, { tags: raw });
    expect(instance.tags).toEqual(raw);
    expect((instance.tags as unknown[])[0]).not.toBeInstanceOf(AddressDto);
  });

  test("copies properties that have no metadata verbatim", () => {
    class Outer {
      @ValidateNested()
      address!: AddressDto;
    }
    const instance = plainToInstance(Outer, {
      address: { city: "x" },
      extra: "kept",
    }) as Outer & { extra: string };
    expect(instance.extra).toBe("kept");
  });
});

describe("stripUnknownProperties / getUnknownPropertyKeys", () => {
  test("keeps the value intact when every key is known", () => {
    const value = { name: "Ada", age: 1, active: true };
    const result = stripUnknownPropertiesWithReport(value, UserDto);
    expect(result.value).toBe(value); // same reference, no copy made
    expect(result.unknownKeys).toEqual([]);
  });

  test("removes unknown keys while preserving known ones", () => {
    const value = { name: "Ada", surprise: "x", age: 1, active: true, extra: 2 };
    const { value: cleaned, unknownKeys } = stripUnknownPropertiesWithReport(value, UserDto);
    expect(Object.keys(cleaned).sort()).toEqual(["active", "age", "name"]);
    expect(unknownKeys.sort()).toEqual(["extra", "surprise"]);
    // The convenience wrapper returns just the cleaned value.
    expect(Object.keys(stripUnknownProperties(value, UserDto)).sort()).toEqual([
      "active",
      "age",
      "name",
    ]);
  });

  test("getUnknownPropertyKeys lists only unknown keys", () => {
    expect(getUnknownPropertyKeys({ name: "x", nope: 1 }, UserDto)).toEqual(["nope"]);
    expect(getUnknownPropertyKeys({ name: "x", age: 1, active: true }, UserDto)).toEqual([]);
  });

  test("getUnknownPropertyKeys returns [] for non-objects and arrays", () => {
    expect(getUnknownPropertyKeys("nope", UserDto)).toEqual([]);
    expect(getUnknownPropertyKeys(null, UserDto)).toEqual([]);
    expect(getUnknownPropertyKeys([{ name: "x" }], UserDto)).toEqual([]);
  });
});

describe("buildSchemaFromClass — type inference & constraint options", () => {
  test("builds an empty object schema for a class with no properties", () => {
    const schema = buildSchemaFromClass(EmptyDto) as any;
    expect(schema.type).toBe("object");
    expect(schema.properties).toEqual({});
  });

  test("infers the type from constraints when no explicit @Is* is given", () => {
    class ConstraintDto {
      @Min(0)
      @Max(10)
      num!: any;
      @MinLength(2)
      @MaxLength(8)
      str!: any;
      @Matches("^a")
      pat!: any;
      @IsEmail()
      mail!: any;
      @ArrayMinSize(1)
      @ArrayMaxSize(3)
      arr!: any;
    }
    const schema = buildSchemaFromClass(ConstraintDto) as any;
    const props = schema.properties;
    expect(props.num.type).toBe("number");
    expect(props.num.minimum).toBe(0);
    expect(props.num.maximum).toBe(10);
    expect(props.str.type).toBe("string");
    expect(props.str.minLength).toBe(2);
    expect(props.str.maxLength).toBe(8);
    expect(props.pat.pattern).toBe("^a");
    expect(props.mail.format).toBe("email");
    expect(props.arr.type).toBe("array");
    expect(props.arr.minItems).toBe(1);
    expect(props.arr.maxItems).toBe(3);
  });

  test("infers the type from the reflected design:type when otherwise ambiguous", () => {
    class DesignTypeDto {
      @IsOptional()
      s?: string;
      @IsOptional()
      n?: number;
      @IsOptional()
      b?: boolean;
      @IsOptional()
      a?: string[];
    }
    const props = (buildSchemaFromClass(DesignTypeDto) as any).properties;
    // Optional props are wrapped, but the underlying inferred type is visible.
    expect(JSON.stringify(props.s)).toContain('"string"');
    expect(JSON.stringify(props.n)).toContain('"number"');
    expect(JSON.stringify(props.b)).toContain('"boolean"');
    expect(JSON.stringify(props.a)).toContain('"array"');
  });

  test("supports explicit integer/boolean/array/enum members", () => {
    class MixedDto {
      @IsInteger()
      count!: number;
      @IsBoolean()
      flag!: boolean;
      @IsArray({ minItems: 1 })
      list!: string[];
      @IsEnum(Role)
      role!: Role;
    }
    const props = (buildSchemaFromClass(MixedDto) as any).properties;
    expect(props.count.type).toBe("integer");
    expect(props.flag.type).toBe("boolean");
    expect(props.list.type).toBe("array");
    expect(props.list.minItems).toBe(1);
    // enum compiles to a union/enum schema (non-empty)
    expect(props.role).toBeDefined();
  });

  test("builds an array schema for a nested collection", () => {
    class CollectionDto {
      @ValidateNested({ each: true })
      items!: AddressDto[];
    }
    const props = (buildSchemaFromClass(CollectionDto) as any).properties;
    expect(props.items.type).toBe("array");
  });

  test("falls back to Any when neither constraints nor design:type resolve a type", () => {
    class AmbiguousDto {
      // Decorated (so it carries metadata) but `any`-typed with no type-bearing
      // constraint → both constraint- and design:type-inference return nothing.
      @IsOptional()
      anything!: any;
    }
    const props = (buildSchemaFromClass(AmbiguousDto) as any).properties;
    // Type.Any() serializes to an empty/unconstrained schema (no `type` field).
    expect(props.anything.type).toBeUndefined();
  });
});
