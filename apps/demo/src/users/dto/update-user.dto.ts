import { Dto, IsEmail, IsOptional, IsString, MinLength } from "../../../../../src/common/index.ts";

/**
 * Patch DTO. `stripUnknown` silently drops unknown top-level properties instead
 * of rejecting the request, so a client can send extra fields without a 422.
 */
@Dto({ stripUnknown: true })
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
