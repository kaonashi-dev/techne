import {
  Dto,
  IsEmail,
  IsEnum,
  IsInteger,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "../../../../../src/common/index.ts";

/** Roles a user can hold. Reused by the schema and the service. */
export const USER_ROLES = ["admin", "editor", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Decorator-style DTO. The metadata compiles to a TypeBox schema that Elysia
 * validates natively; unknown properties are rejected with a 422 problem+json.
 */
@Dto()
export class CreateUserDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  email!: string;

  @IsEnum(USER_ROLES)
  role!: UserRole;

  @IsOptional()
  @IsInteger()
  @Min(0)
  @Max(150)
  age?: number;
}
